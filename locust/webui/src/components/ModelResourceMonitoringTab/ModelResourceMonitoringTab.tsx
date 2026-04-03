import { useMemo, useState } from 'react';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import {
    Alert,
    Box,
    Button,
    CircularProgress,
    Collapse,
    FormControl,
    InputLabel,
    MenuItem,
    Paper,
    Select,
    TextField,
    Typography,
} from '@mui/material';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import LineChart from 'components/LineChart/LineChart';

dayjs.extend(utc);
dayjs.extend(timezone);

type TimeSeriesResponse = unknown;

type MonitoringResponse = {
    memoryBytesUsed?: TimeSeriesResponse;
    cpuUtilization?: TimeSeriesResponse;
    acceleratorDutyCycle?: TimeSeriesResponse;
    acceleratorMemoryBytes?: TimeSeriesResponse;
    replicas?: TimeSeriesResponse;
    targetReplicas?: TimeSeriesResponse;
    networkReceivedBytes?: TimeSeriesResponse;
    networkSentBytes?: TimeSeriesResponse;
};

const DEFAULT_PROJECT_ID = 'fzo-edu-ds';
const DEFAULT_ENDPOINT_ID = '8045470177820672000';

const TIMEZONE_OPTIONS: string[] = (
    typeof Intl !== 'undefined' && typeof (Intl as any).supportedValuesOf === 'function'
        ? (Intl as any).supportedValuesOf('timeZone')
        : ['UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Asia/Tokyo', 'Asia/Colombo']
).sort((a: string, b: string) => a.localeCompare(b));

function utcInstantToApiIso(d: Dayjs): string {
    return d.utc().format('YYYY-MM-DDTHH:mm:ss[Z]');
}

/** Default interval: last 1 hour ending at load time (UTC for the Monitoring API). */
function getDefaultMonitoringIntervalUtc(): { startUtc: string; endUtc: string } {
    const end = dayjs.utc();
    const start = end.subtract(1, 'hour');
    return {
        startUtc: utcInstantToApiIso(start),
        endUtc: utcInstantToApiIso(end),
    };
}

const DEFAULT_AUTH = 'Bearer {Paste the Token}';

const MEMORY_METRIC_FILTER = (endpointId: string) =>
    `resource.type="aiplatform.googleapis.com/Endpoint" AND metric.type="aiplatform.googleapis.com/prediction/online/memory/bytes_used" AND resource.labels.endpoint_id="${endpointId}"`;

const CPU_METRIC_FILTER = (endpointId: string) =>
    `resource.type="aiplatform.googleapis.com/Endpoint" AND metric.type="aiplatform.googleapis.com/prediction/online/cpu/utilization" AND resource.labels.endpoint_id="${endpointId}"`;

const ACCELERATOR_DUTY_CYCLE_METRIC_FILTER = (endpointId: string) =>
    `resource.type="aiplatform.googleapis.com/Endpoint" AND metric.type="aiplatform.googleapis.com/prediction/online/accelerator/duty_cycle" AND resource.labels.endpoint_id="${endpointId}"`;

const ACCELERATOR_MEMORY_BYTES_METRIC_FILTER = (endpointId: string) =>
    `resource.type="aiplatform.googleapis.com/Endpoint" AND metric.type="aiplatform.googleapis.com/prediction/online/accelerator/memory/bytes_used" AND resource.labels.endpoint_id="${endpointId}"`;

const REPLICAS_METRIC_FILTER = (endpointId: string) =>
    `resource.type="aiplatform.googleapis.com/Endpoint" AND metric.type="aiplatform.googleapis.com/prediction/online/replicas" AND resource.labels.endpoint_id="${endpointId}"`;

const TARGET_REPLICAS_METRIC_FILTER = (endpointId: string) =>
    `resource.type="aiplatform.googleapis.com/Endpoint" AND metric.type="aiplatform.googleapis.com/prediction/online/target_replicas" AND resource.labels.endpoint_id="${endpointId}"`;

const NETWORK_RECEIVED_BYTES_METRIC_FILTER = (endpointId: string) =>
    `resource.type="aiplatform.googleapis.com/Endpoint" AND metric.type="aiplatform.googleapis.com/prediction/online/network/received_bytes_count" AND resource.labels.endpoint_id="${endpointId}"`;

const NETWORK_SENT_BYTES_METRIC_FILTER = (endpointId: string) =>
    `resource.type="aiplatform.googleapis.com/Endpoint" AND metric.type="aiplatform.googleapis.com/prediction/online/network/sent_bytes_count" AND resource.labels.endpoint_id="${endpointId}"`;

const MONITORING_JSON_PRE_SX = {
    m: 0,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    fontFamily: 'monospace',
    fontSize: '12px',
    maxHeight: 220,
    overflow: 'auto',
    backgroundColor: 'rgba(0,0,0,0.03)',
    borderRadius: 1,
    p: 1,
};

function CollapsibleRawJson({ data }: { data: unknown }) {
    const [open, setOpen] = useState(false);
    return (
        <Box>
            <Button
                variant='text'
                size='small'
                aria-expanded={open}
                onClick={() => setOpen(o => !o)}
                endIcon={
                    <ExpandMoreIcon
                        sx={{
                            transition: 'transform 0.2s',
                            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
                        }}
                    />
                }
                sx={{ textTransform: 'none', px: 0, minWidth: 0, color: 'text.secondary' }}
            >
                {open ? 'Hide raw JSON' : 'Show raw JSON'}
            </Button>
            <Collapse in={open}>
                <Box component='pre' sx={MONITORING_JSON_PRE_SX}>
                    {JSON.stringify(data ?? null, null, 2)}
                </Box>
            </Collapse>
        </Box>
    );
}

function buildMonitoringTimeSeriesUrl(
    projectId: string,
    filter: string,
    startUtc: string,
    endUtc: string,
): string {
    const params = new URLSearchParams({
        filter,
        'interval.startTime': startUtc,
        'interval.endTime': endUtc,
        pageSize: '10000',
    });
    return `https://monitoring.googleapis.com/v3/projects/${encodeURIComponent(projectId)}/timeSeries?${params.toString()}`;
}

async function fetchJsonOrThrow(url: string, authorization: string): Promise<unknown> {
    const res = await fetch(url, {
        method: 'GET',
        headers: {
            Authorization: authorization,
            accept: 'application/json',
        },
    });

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Request failed (${res.status}): ${text || res.statusText}`);
    }

    return res.json();
}

/**
 * Google Monitoring `timeSeries.list` is paginated (`nextPageToken`). The UI must follow pages
 * or it will only see a subset of series/points compared to Postman if Postman loads the full set.
 */
async function fetchMonitoringTimeSeriesAllPages(
    urlString: string,
    authorization: string,
): Promise<Record<string, unknown>> {
    const url = new URL(urlString);
    if (!url.searchParams.has('pageSize')) {
        url.searchParams.set('pageSize', '10000');
    }

    const mergedSeries: unknown[] = [];
    let nextPageToken: string | undefined;
    let meta: Record<string, unknown> | null = null;

    do {
        if (nextPageToken) {
            url.searchParams.set('pageToken', nextPageToken);
        } else {
            url.searchParams.delete('pageToken');
        }

        const page = (await fetchJsonOrThrow(url.toString(), authorization)) as Record<string, unknown> & {
            timeSeries?: unknown[];
            nextPageToken?: string;
        };

        if (meta === null) {
            meta = { ...page };
            delete meta.timeSeries;
            delete meta.nextPageToken;
        }

        if (Array.isArray(page.timeSeries)) {
            mergedSeries.push(...page.timeSeries);
        }

        nextPageToken = page.nextPageToken as string | undefined;
    } while (nextPageToken);

    return { ...(meta ?? {}), timeSeries: mergedSeries };
}

const BYTES_PER_GIB = 1024 * 1024 * 1024;

const MONITORING_LINE_COLORS = [
    '#0099ff',
    '#ff6d6d',
    '#00ca5a',
    '#9966CC',
    '#ff9f00',
    '#8A2BE2',
    '#00bcd4',
    '#E68508',
    '#4caf50',
    '#e91e63',
];

/** Title stays top; legend at bottom so labels never overlap the chart title. */
const MONITORING_CHART_HEIGHT = 400;
/** Wider left margin so Y-axis `name` (including long replica labels) is not clipped. */
const MONITORING_CHART_GRID = { left: 96, right: 32, top: 52, bottom: 88 };
const MONITORING_CHART_LEGEND = {
    type: 'scroll' as const,
    orient: 'horizontal' as const,
    left: 'center' as const,
    bottom: 6,
    width: '100%',
    itemHeight: 18,
    itemGap: 10,
    itemWidth: 14,
    textStyle: { fontSize: 11 },
    pageIconSize: 10,
    pageTextStyle: { fontSize: 10 },
};

/** Shown as ECharts Y-axis `name` (unit / meaning of the plotted values). */
const Y_AXIS_LABEL_MEMORY = 'GiB';
const Y_AXIS_LABEL_CPU = '%';
/** Duty cycle is a 0–1 fraction in the API; chart scales to percent like CPU. */
const Y_AXIS_LABEL_ACCELERATOR_DUTY_CYCLE = '%';
const Y_AXIS_LABEL_REPLICAS = 'Number of active replicas';
const Y_AXIS_LABEL_TARGET_REPLICAS = 'Target number of replicas';
const Y_AXIS_LABEL_NETWORK = 'GiB';

function sanitizeKeyPart(s: string): string {
    const t = String(s).replace(/[^a-zA-Z0-9_-]/g, '_');
    return t || 'id';
}

function seriesKeyFromMetric(metric: any, index: number, used: Set<string>): string {
    const rid = String(metric?.labels?.replica_id ?? '').trim();
    const mid = String(metric?.labels?.deployed_model_id ?? '').trim();
    const spot = String(metric?.labels?.spot ?? '').trim();
    const base = rid
        ? `replica_${sanitizeKeyPart(rid)}`
        : mid
            ? `model_${sanitizeKeyPart(mid)}${spot ? `_spot_${sanitizeKeyPart(spot)}` : ''}`
            : `series_${index}`;
    let k = base;
    let n = 0;
    while (used.has(k)) {
        k = `${base}_${++n}`;
    }
    used.add(k);
    return k;
}

/** Prefer last two dash segments (e.g. k8s-style pod id) so legends stay readable. */
function shortenResourceLabel(id: string): string {
    const t = id.trim();
    if (!t) return t;
    const parts = t.split('-').filter(Boolean);
    if (parts.length >= 3) {
        const lastTwo = parts.slice(-2).join('-');
        if (lastTwo.length <= 36) return lastTwo;
        return `${lastTwo.slice(0, 14)}…${lastTwo.slice(-12)}`;
    }
    if (t.length <= 32) return t;
    return `${t.slice(0, 12)}…${t.slice(-14)}`;
}

function seriesDisplayName(metric: any, index: number): string {
    const rid = String(metric?.labels?.replica_id ?? '').trim();
    const mid = String(metric?.labels?.deployed_model_id ?? '').trim();
    const mname = String(metric?.labels?.model_display_name ?? '').trim();
    const spot = String(metric?.labels?.spot ?? '').trim();
    const spotSuffix = spot ? ` · spot ${spot}` : '';
    if (rid) return `Replica ${shortenResourceLabel(rid)}`;
    if (mname) return `${mname}${spotSuffix}`;
    if (mid) return `Model ${shortenResourceLabel(mid)}${spotSuffix}`;
    return `Series ${index + 1}`;
}

function dedupeTimeValuePairs(pairs: [number, number][]): [number, number][] {
    const byTime = new Map<number, number>();
    for (const [t, v] of pairs) {
        if (!Number.isFinite(t) || !Number.isFinite(v)) continue;
        byTime.set(t, v);
    }
    return Array.from(byTime.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([t, v]) => [t, v]);
}

/** Series data uses `[utcMs, y]` so ECharts time axis places points reliably. `time` = sorted ISO union. */
type MonitoringMultiLineChartData = {
    time: string[];
} & Record<string, [number, number][]>;

type MonitoringMultiLineBundle = {
    charts: MonitoringMultiLineChartData;
    lines: { name: string; key: keyof MonitoringMultiLineChartData }[];
    colors: string[];
};

function extractNumber(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const asNumber = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(asNumber) ? asNumber : null;
}

function extractPointNumeric(pv: unknown): number | null {
    if (!pv || typeof pv !== 'object') return null;
    const v = pv as any;
    return (
        extractNumber(v.doubleValue) ??
        extractNumber(v.int64Value) ??
        extractNumber(v.floatValue) ??
        extractNumber(v.stringValue)
    );
}

function int64LikeToBytes(pointValue: unknown): number | null {
    if (!pointValue || typeof pointValue !== 'object') return null;
    const pv = pointValue as any;
    return (
        extractNumber(pv.int64Value) ??
        extractNumber(pv.doubleValue) ??
        extractNumber(pv.floatValue) ??
        extractNumber(pv.stringValue)
    );
}

/** Generic GAUGE-style points: map raw API number to y (e.g. CPU fraction → percent). */
function buildGenericNumericMultiLineBundle(
    raw: any,
    mapValue: (rawValue: number) => number | null,
): MonitoringMultiLineBundle | null {
    const timeSeriesList: unknown = raw?.timeSeries;
    if (!Array.isArray(timeSeriesList) || timeSeriesList.length === 0) return null;

    const usedKeys = new Set<string>();
    const lineDefs: { name: string; key: string }[] = [];
    const charts: Record<string, unknown> = { time: [] as string[] };
    const allTimes = new Set<number>();

    for (let index = 0; index < timeSeriesList.length; index++) {
        const ts = timeSeriesList[index] as any;
        const pts = ts?.points;
        if (!Array.isArray(pts)) continue;

        const pairs: [number, number][] = [];
        for (const p of pts) {
            const x = p?.interval?.startTime ?? p?.interval?.endTime;
            const ms = typeof x === 'string' || typeof x === 'number' ? Date.parse(String(x)) : NaN;
            const rawVal = extractPointNumeric(p?.value);
            if (!Number.isFinite(ms) || rawVal === null) continue;
            const y = mapValue(rawVal);
            if (y === null || !Number.isFinite(y)) continue;
            pairs.push([ms, y]);
            allTimes.add(ms);
        }
        if (pairs.length === 0) continue;

        const deduped = dedupeTimeValuePairs(pairs);

        const key = seriesKeyFromMetric(ts?.metric, index, usedKeys);
        const name = seriesDisplayName(ts?.metric, index);
        charts[key] = deduped;
        lineDefs.push({ name, key });
    }

    if (lineDefs.length === 0) return null;

    charts.time = Array.from(allTimes)
        .sort((a, b) => a - b)
        .map(ms => new Date(ms).toISOString());

    const colors = lineDefs.map((_, i) => MONITORING_LINE_COLORS[i % MONITORING_LINE_COLORS.length]);

    return {
        charts: charts as MonitoringMultiLineChartData,
        lines: lineDefs.map(l => ({ ...l, key: l.key as keyof MonitoringMultiLineChartData })),
        colors,
    };
}

function buildMemoryMultiLineBundle(raw: any): MonitoringMultiLineBundle | null {
    const timeSeriesList: unknown = raw?.timeSeries;
    if (!Array.isArray(timeSeriesList) || timeSeriesList.length === 0) return null;

    const usedKeys = new Set<string>();
    const lineDefs: { name: string; key: string }[] = [];
    const charts: Record<string, unknown> = { time: [] as string[] };
    const allTimes = new Set<number>();

    for (let index = 0; index < timeSeriesList.length; index++) {
        const ts = timeSeriesList[index] as any;
        const pts = ts?.points;
        if (!Array.isArray(pts)) continue;

        const pairs: [number, number][] = [];
        for (const p of pts) {
            const x = p?.interval?.startTime ?? p?.interval?.endTime;
            const ms = typeof x === 'string' || typeof x === 'number' ? Date.parse(String(x)) : NaN;
            const bytes = int64LikeToBytes(p?.value);
            if (!Number.isFinite(ms) || bytes === null) continue;
            const gib = bytes / BYTES_PER_GIB;
            if (!Number.isFinite(gib)) continue;
            pairs.push([ms, gib]);
            allTimes.add(ms);
        }
        if (pairs.length === 0) continue;

        const deduped = dedupeTimeValuePairs(pairs);

        const key = seriesKeyFromMetric(ts?.metric, index, usedKeys);
        const name = seriesDisplayName(ts?.metric, index);
        charts[key] = deduped;
        lineDefs.push({ name, key });
    }

    if (lineDefs.length === 0) return null;

    charts.time = Array.from(allTimes)
        .sort((a, b) => a - b)
        .map(ms => new Date(ms).toISOString());

    const colors = lineDefs.map((_, i) => MONITORING_LINE_COLORS[i % MONITORING_LINE_COLORS.length]);

    return {
        charts: charts as MonitoringMultiLineChartData,
        lines: lineDefs.map(l => ({ ...l, key: l.key as keyof MonitoringMultiLineChartData })),
        colors,
    };
}

function buildCpuMultiLineBundle(raw: any): MonitoringMultiLineBundle | null {
    return buildGenericNumericMultiLineBundle(raw, v => v * 100);
}

function buildAcceleratorDutyCycleMultiLineBundle(raw: any): MonitoringMultiLineBundle | null {
    return buildGenericNumericMultiLineBundle(raw, v => v * 100);
}

function buildReplicaCountMultiLineBundle(raw: any): MonitoringMultiLineBundle | null {
    return buildGenericNumericMultiLineBundle(raw, v => v);
}

export default function ModelResourceMonitoringTab() {
    const [projectId, setProjectId] = useState(DEFAULT_PROJECT_ID);
    const [endpointId, setEndpointId] = useState(DEFAULT_ENDPOINT_ID);
    /** Stored as UTC RFC3339 (`...Z`) for Monitoring API and URLs. Default: last hour ending at page load. */
    const defaultMonitoringInterval = useMemo(() => getDefaultMonitoringIntervalUtc(), []);
    const [startUtc, setStartUtc] = useState(defaultMonitoringInterval.startUtc);
    const [endUtc, setEndUtc] = useState(defaultMonitoringInterval.endUtc);
    /** IANA timezone used for pickers and chart axis labels. */
    const [timezone, setTimezone] = useState<string>(() =>
        typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC',
    );

    const [authorization, setAuthorization] = useState(DEFAULT_AUTH);
    const [authorizationError, setAuthorizationError] = useState(false);

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [response, setResponse] = useState<MonitoringResponse | null>(null);

    const memoryUrl = useMemo(
        () => buildMonitoringTimeSeriesUrl(projectId, MEMORY_METRIC_FILTER(endpointId), startUtc, endUtc),
        [endpointId, endUtc, projectId, startUtc],
    );

    const cpuUrl = useMemo(
        () => buildMonitoringTimeSeriesUrl(projectId, CPU_METRIC_FILTER(endpointId), startUtc, endUtc),
        [endpointId, endUtc, projectId, startUtc],
    );

    const acceleratorDutyCycleUrl = useMemo(
        () =>
            buildMonitoringTimeSeriesUrl(projectId, ACCELERATOR_DUTY_CYCLE_METRIC_FILTER(endpointId), startUtc, endUtc),
        [endpointId, endUtc, projectId, startUtc],
    );

    const acceleratorMemoryUrl = useMemo(
        () =>
            buildMonitoringTimeSeriesUrl(projectId, ACCELERATOR_MEMORY_BYTES_METRIC_FILTER(endpointId), startUtc, endUtc),
        [endpointId, endUtc, projectId, startUtc],
    );

    const replicasUrl = useMemo(
        () => buildMonitoringTimeSeriesUrl(projectId, REPLICAS_METRIC_FILTER(endpointId), startUtc, endUtc),
        [endpointId, endUtc, projectId, startUtc],
    );

    const targetReplicasUrl = useMemo(
        () => buildMonitoringTimeSeriesUrl(projectId, TARGET_REPLICAS_METRIC_FILTER(endpointId), startUtc, endUtc),
        [endpointId, endUtc, projectId, startUtc],
    );

    const networkReceivedUrl = useMemo(
        () =>
            buildMonitoringTimeSeriesUrl(projectId, NETWORK_RECEIVED_BYTES_METRIC_FILTER(endpointId), startUtc, endUtc),
        [endpointId, endUtc, projectId, startUtc],
    );

    const networkSentUrl = useMemo(
        () => buildMonitoringTimeSeriesUrl(projectId, NETWORK_SENT_BYTES_METRIC_FILTER(endpointId), startUtc, endUtc),
        [endpointId, endUtc, projectId, startUtc],
    );

    const startPickerValue = useMemo((): Dayjs | null => {
        const d = dayjs.utc(startUtc);
        return d.isValid() ? d.tz(timezone) : null;
    }, [startUtc, timezone]);

    const endPickerValue = useMemo((): Dayjs | null => {
        const d = dayjs.utc(endUtc);
        return d.isValid() ? d.tz(timezone) : null;
    }, [endUtc, timezone]);

    const monitoringChartXAxis = useMemo(() => {
        const startMs = Date.parse(startUtc);
        const endMs = Date.parse(endUtc);
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) {
            return undefined;
        }
        const splitNumber =
            typeof window !== 'undefined' && window.innerWidth < 900 ? 4 : 8;
        return {
            type: 'time' as const,
            min: startMs,
            max: endMs,
            splitNumber,
            axisLabel: {
                formatter: (value: number | string) => {
                    const ms = typeof value === 'number' ? value : Date.parse(String(value));
                    const d = dayjs(ms).tz(timezone);
                    return d.isValid() ? d.format('MMM D, HH:mm') : String(value);
                },
            },
        };
    }, [endUtc, startUtc, timezone]);

    const monitoringChartKey = `${timezone}\0${startUtc}\0${endUtc}`;

    const submitDisabled =
        isSubmitting ||
        !projectId.trim() ||
        !endpointId.trim() ||
        !startUtc.trim() ||
        !endUtc.trim() ||
        !dayjs.utc(startUtc).isValid() ||
        !dayjs.utc(endUtc).isValid() ||
        Date.parse(endUtc) <= Date.parse(startUtc);

    const onSubmit = async () => {
        if (authorization.trim().length === 0) {
            setAuthorizationError(true);
            return;
        }
        setAuthorizationError(false);

        setErrorMessage(null);
        setResponse(null);
        setIsSubmitting(true);

        try {
            const [
                memoryBytesUsed,
                cpuUtilization,
                acceleratorDutyCycle,
                acceleratorMemoryBytes,
                replicas,
                targetReplicas,
                networkReceivedBytes,
                networkSentBytes,
            ] = await Promise.all([
                fetchMonitoringTimeSeriesAllPages(memoryUrl, authorization),
                fetchMonitoringTimeSeriesAllPages(cpuUrl, authorization),
                fetchMonitoringTimeSeriesAllPages(acceleratorDutyCycleUrl, authorization),
                fetchMonitoringTimeSeriesAllPages(acceleratorMemoryUrl, authorization),
                fetchMonitoringTimeSeriesAllPages(replicasUrl, authorization),
                fetchMonitoringTimeSeriesAllPages(targetReplicasUrl, authorization),
                fetchMonitoringTimeSeriesAllPages(networkReceivedUrl, authorization),
                fetchMonitoringTimeSeriesAllPages(networkSentUrl, authorization),
            ]);

            setResponse({
                memoryBytesUsed,
                cpuUtilization,
                acceleratorDutyCycle,
                acceleratorMemoryBytes,
                replicas,
                targetReplicas,
                networkReceivedBytes,
                networkSentBytes,
            });
        } catch (err) {
            setErrorMessage(err instanceof Error ? err.message : 'Request failed');
        } finally {
            setIsSubmitting(false);
        }
    };

    const memoryChart = useMemo(
        () => buildMemoryMultiLineBundle(response?.memoryBytesUsed as any),
        [response?.memoryBytesUsed],
    );

    const cpuChart = useMemo(
        () => buildCpuMultiLineBundle(response?.cpuUtilization as any),
        [response?.cpuUtilization],
    );

    const acceleratorDutyCycleChart = useMemo(
        () => buildAcceleratorDutyCycleMultiLineBundle(response?.acceleratorDutyCycle as any),
        [response?.acceleratorDutyCycle],
    );

    const acceleratorMemoryChart = useMemo(
        () => buildMemoryMultiLineBundle(response?.acceleratorMemoryBytes as any),
        [response?.acceleratorMemoryBytes],
    );

    const replicasChart = useMemo(
        () => buildReplicaCountMultiLineBundle(response?.replicas as any),
        [response?.replicas],
    );

    const targetReplicasChart = useMemo(
        () => buildReplicaCountMultiLineBundle(response?.targetReplicas as any),
        [response?.targetReplicas],
    );

    const networkReceivedChart = useMemo(
        () => buildMemoryMultiLineBundle(response?.networkReceivedBytes as any),
        [response?.networkReceivedBytes],
    );

    const networkSentChart = useMemo(
        () => buildMemoryMultiLineBundle(response?.networkSentBytes as any),
        [response?.networkSentBytes],
    );

    return (
        <LocalizationProvider dateAdapter={AdapterDayjs}>
            <Box sx={{ display: 'flex', flexDirection: 'column', rowGap: 2, p: 2 }}>
                <Typography variant='h6' sx={{ fontWeight: 600 }}>
                    Model Resource Monitoring
                </Typography>

                <Paper variant='outlined' sx={{ p: 2 }}>
                    <Typography variant='subtitle1' sx={{ fontWeight: 700, mb: 1 }}>
                        Query Google Cloud Monitoring (timeSeries)
                    </Typography>

                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
                        <TextField label='project_id' value={projectId} onChange={e => setProjectId(e.target.value)} />
                        <TextField label='endpoint_id' value={endpointId} onChange={e => setEndpointId(e.target.value)} />

                        <FormControl sx={{ gridColumn: { xs: '1 / -1', md: '1 / -1' } }} fullWidth>
                            <InputLabel id='monitoring-timezone-label'>Timezone (pickers + charts)</InputLabel>
                            <Select
                                labelId='monitoring-timezone-label'
                                label='Timezone (pickers + charts)'
                                value={timezone}
                                onChange={e => setTimezone(e.target.value)}
                                MenuProps={{ PaperProps: { sx: { maxHeight: 320 } } }}
                            >
                                {TIMEZONE_OPTIONS.map(tz => (
                                    <MenuItem key={tz} value={tz}>
                                        {tz}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>

                        <DateTimePicker
                            timezone={timezone}
                            label='Interval start (local)'
                            value={startPickerValue}
                            onChange={(v: Dayjs | null) => {
                                if (v) setStartUtc(utcInstantToApiIso(v));
                            }}
                            slotProps={{
                                textField: { fullWidth: true },
                            }}
                        />
                        <DateTimePicker
                            timezone={timezone}
                            label='Interval end (local)'
                            value={endPickerValue}
                            onChange={(v: Dayjs | null) => {
                                if (v) setEndUtc(utcInstantToApiIso(v));
                            }}
                            slotProps={{
                                textField: { fullWidth: true },
                            }}
                        />

                        <Typography variant='body2' color='text.secondary' sx={{ gridColumn: { xs: '1 / -1', md: '1 / -1' } }}>
                            API / URL uses UTC: <Box component='span' sx={{ fontFamily: 'monospace' }}>{startUtc}</Box>
                            {' → '}
                            <Box component='span' sx={{ fontFamily: 'monospace' }}>{endUtc}</Box>
                        </Typography>

                        <TextField
                            label='Authorization'
                            value={authorization}
                            onChange={e => {
                                setAuthorization(e.target.value);
                                if (authorizationError && e.target.value.trim().length > 0) {
                                    setAuthorizationError(false);
                                }
                            }}
                            error={authorizationError}
                            helperText={authorizationError ? 'Authorization is required' : ''}
                            sx={{ gridColumn: { xs: '1 / -1', md: '1 / -1' } }}
                            required
                        />
                    </Box>

                    <Box sx={{ display: 'flex', gap: 2, mt: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                        <Button variant='contained' color='primary' onClick={onSubmit} disabled={submitDisabled}>
                            {isSubmitting ? 'Fetching...' : 'Fetch Monitoring Data'}
                        </Button>
                        {isSubmitting && <CircularProgress size={24} />}
                    </Box>

                    {errorMessage && (
                        <Alert severity='error' sx={{ mt: 2 }}>
                            {errorMessage}
                        </Alert>
                    )}
                </Paper>

                {response && (
                    <Paper variant='outlined' sx={{ p: 2 }}>
                        <Typography variant='subtitle1' sx={{ fontWeight: 700, mb: 1 }}>
                            Monitoring results (separate)
                        </Typography>
                        <Typography variant='body2' color='text.secondary' sx={{ mb: 2 }}>
                            One line per time series. Replica / network charts use replica id or model labels. X-axis
                            uses {timezone}. Raw JSON timestamps are UTC.
                        </Typography>

                        <Box sx={{ display: 'flex', flexDirection: 'column', rowGap: 3 }}>
                            <Box>
                                <Typography sx={{ fontWeight: 700, mb: 1 }}>Memory (bytes_used)</Typography>
                                {memoryChart && memoryChart.lines.length > 0 ? (
                                    <Box sx={{ mb: 2 }}>
                                        <LineChart<MonitoringMultiLineChartData>
                                            key={`memory-${monitoringChartKey}`}
                                            title='Memory Used (GiB)'
                                            charts={memoryChart.charts}
                                            colors={memoryChart.colors}
                                            lines={memoryChart.lines}
                                            yAxisLabels={Y_AXIS_LABEL_MEMORY}
                                            legend={MONITORING_CHART_LEGEND}
                                            grid={MONITORING_CHART_GRID}
                                            height={MONITORING_CHART_HEIGHT}
                                            xAxis={monitoringChartXAxis}
                                            chartValueFormatter={value => {
                                                const y =
                                                    Array.isArray(value) ? extractNumber(value[1]) : extractNumber(value);
                                                return y === null ? '-' : y.toFixed(3);
                                            }}
                                        />
                                    </Box>
                                ) : (
                                    <Typography variant='body2' color='text.secondary' sx={{ mb: 2 }}>
                                        No memory points parsed for a chart.
                                    </Typography>
                                )}
                                <CollapsibleRawJson data={response.memoryBytesUsed} />
                            </Box>

                            <Box>
                                <Typography sx={{ fontWeight: 700, mb: 1 }}>CPU (utilization)</Typography>
                                {cpuChart && cpuChart.lines.length > 0 ? (
                                    <Box sx={{ mb: 2 }}>
                                        <LineChart<MonitoringMultiLineChartData>
                                            key={`cpu-${monitoringChartKey}`}
                                            title='CPU Utilization (percent)'
                                            charts={cpuChart.charts}
                                            colors={cpuChart.colors}
                                            lines={cpuChart.lines}
                                            yAxisLabels={Y_AXIS_LABEL_CPU}
                                            legend={MONITORING_CHART_LEGEND}
                                            grid={MONITORING_CHART_GRID}
                                            height={MONITORING_CHART_HEIGHT}
                                            xAxis={monitoringChartXAxis}
                                            chartValueFormatter={value => {
                                                const y =
                                                    Array.isArray(value) ? extractNumber(value[1]) : extractNumber(value);
                                                return y === null ? '-' : y.toFixed(3);
                                            }}
                                        />
                                    </Box>
                                ) : (
                                    <Typography variant='body2' color='text.secondary' sx={{ mb: 2 }}>
                                        No CPU points parsed for a chart.
                                    </Typography>
                                )}
                                <CollapsibleRawJson data={response.cpuUtilization} />
                            </Box>

                            <Box>
                                <Typography sx={{ fontWeight: 700, mb: 1 }}>
                                    Accelerator duty cycle (online/accelerator/duty_cycle)
                                </Typography>
                                {acceleratorDutyCycleChart && acceleratorDutyCycleChart.lines.length > 0 ? (
                                    <Box sx={{ mb: 2 }}>
                                        <LineChart<MonitoringMultiLineChartData>
                                            key={`accel-duty-${monitoringChartKey}`}
                                            title='Accelerator duty cycle (percent)'
                                            charts={acceleratorDutyCycleChart.charts}
                                            colors={acceleratorDutyCycleChart.colors}
                                            lines={acceleratorDutyCycleChart.lines}
                                            yAxisLabels={Y_AXIS_LABEL_ACCELERATOR_DUTY_CYCLE}
                                            legend={MONITORING_CHART_LEGEND}
                                            grid={MONITORING_CHART_GRID}
                                            height={MONITORING_CHART_HEIGHT}
                                            xAxis={monitoringChartXAxis}
                                            chartValueFormatter={value => {
                                                const y =
                                                    Array.isArray(value) ? extractNumber(value[1]) : extractNumber(value);
                                                return y === null ? '-' : y.toFixed(3);
                                            }}
                                        />
                                    </Box>
                                ) : (
                                    <Typography variant='body2' color='text.secondary' sx={{ mb: 2 }}>
                                        No accelerator duty cycle points parsed for a chart.
                                    </Typography>
                                )}
                                <CollapsibleRawJson data={response.acceleratorDutyCycle} />
                            </Box>

                            <Box>
                                <Typography sx={{ fontWeight: 700, mb: 1 }}>
                                    Accelerator memory (online/accelerator/memory/bytes_used)
                                </Typography>
                                {acceleratorMemoryChart && acceleratorMemoryChart.lines.length > 0 ? (
                                    <Box sx={{ mb: 2 }}>
                                        <LineChart<MonitoringMultiLineChartData>
                                            key={`accel-mem-${monitoringChartKey}`}
                                            title='Accelerator memory used (GiB)'
                                            charts={acceleratorMemoryChart.charts}
                                            colors={acceleratorMemoryChart.colors}
                                            lines={acceleratorMemoryChart.lines}
                                            yAxisLabels={Y_AXIS_LABEL_MEMORY}
                                            legend={MONITORING_CHART_LEGEND}
                                            grid={MONITORING_CHART_GRID}
                                            height={MONITORING_CHART_HEIGHT}
                                            xAxis={monitoringChartXAxis}
                                            chartValueFormatter={value => {
                                                const y =
                                                    Array.isArray(value) ? extractNumber(value[1]) : extractNumber(value);
                                                return y === null ? '-' : y.toFixed(3);
                                            }}
                                        />
                                    </Box>
                                ) : (
                                    <Typography variant='body2' color='text.secondary' sx={{ mb: 2 }}>
                                        No accelerator memory points parsed for a chart.
                                    </Typography>
                                )}
                                <CollapsibleRawJson data={response.acceleratorMemoryBytes} />
                            </Box>

                            <Box>
                                <Typography sx={{ fontWeight: 700, mb: 1 }}>Replicas (online/replicas)</Typography>
                                {replicasChart && replicasChart.lines.length > 0 ? (
                                    <Box sx={{ mb: 2 }}>
                                        <LineChart<MonitoringMultiLineChartData>
                                            key={`replicas-${monitoringChartKey}`}
                                            title='Replica count'
                                            charts={replicasChart.charts}
                                            colors={replicasChart.colors}
                                            lines={replicasChart.lines}
                                            yAxisLabels={Y_AXIS_LABEL_REPLICAS}
                                            legend={MONITORING_CHART_LEGEND}
                                            grid={MONITORING_CHART_GRID}
                                            height={MONITORING_CHART_HEIGHT}
                                            xAxis={monitoringChartXAxis}
                                            chartValueFormatter={value => {
                                                const y =
                                                    Array.isArray(value) ? extractNumber(value[1]) : extractNumber(value);
                                                return y === null ? '-' : y.toFixed(2);
                                            }}
                                        />
                                    </Box>
                                ) : (
                                    <Typography variant='body2' color='text.secondary' sx={{ mb: 2 }}>
                                        No replica count points parsed for a chart.
                                    </Typography>
                                )}
                                <CollapsibleRawJson data={response.replicas} />
                            </Box>

                            <Box>
                                <Typography sx={{ fontWeight: 700, mb: 1 }}>Target replicas (online/target_replicas)</Typography>
                                {targetReplicasChart && targetReplicasChart.lines.length > 0 ? (
                                    <Box sx={{ mb: 2 }}>
                                        <LineChart<MonitoringMultiLineChartData>
                                            key={`target-replicas-${monitoringChartKey}`}
                                            title='Target replica count'
                                            charts={targetReplicasChart.charts}
                                            colors={targetReplicasChart.colors}
                                            lines={targetReplicasChart.lines}
                                            yAxisLabels={Y_AXIS_LABEL_TARGET_REPLICAS}
                                            legend={MONITORING_CHART_LEGEND}
                                            grid={MONITORING_CHART_GRID}
                                            height={MONITORING_CHART_HEIGHT}
                                            xAxis={monitoringChartXAxis}
                                            chartValueFormatter={value => {
                                                const y =
                                                    Array.isArray(value) ? extractNumber(value[1]) : extractNumber(value);
                                                return y === null ? '-' : y.toFixed(2);
                                            }}
                                        />
                                    </Box>
                                ) : (
                                    <Typography variant='body2' color='text.secondary' sx={{ mb: 2 }}>
                                        No target replica points parsed for a chart.
                                    </Typography>
                                )}
                                <CollapsibleRawJson data={response.targetReplicas} />
                            </Box>

                            <Box>
                                <Typography sx={{ fontWeight: 700, mb: 1 }}>Network received (received_bytes_count)</Typography>
                                {networkReceivedChart && networkReceivedChart.lines.length > 0 ? (
                                    <Box sx={{ mb: 2 }}>
                                        <LineChart<MonitoringMultiLineChartData>
                                            key={`net-rx-${monitoringChartKey}`}
                                            title='Network bytes received (GiB)'
                                            charts={networkReceivedChart.charts}
                                            colors={networkReceivedChart.colors}
                                            lines={networkReceivedChart.lines}
                                            yAxisLabels={Y_AXIS_LABEL_NETWORK}
                                            legend={MONITORING_CHART_LEGEND}
                                            grid={MONITORING_CHART_GRID}
                                            height={MONITORING_CHART_HEIGHT}
                                            xAxis={monitoringChartXAxis}
                                            chartValueFormatter={value => {
                                                const y =
                                                    Array.isArray(value) ? extractNumber(value[1]) : extractNumber(value);
                                                return y === null ? '-' : y.toFixed(3);
                                            }}
                                        />
                                    </Box>
                                ) : (
                                    <Typography variant='body2' color='text.secondary' sx={{ mb: 2 }}>
                                        No network received points parsed for a chart.
                                    </Typography>
                                )}
                                <CollapsibleRawJson data={response.networkReceivedBytes} />
                            </Box>

                            <Box>
                                <Typography sx={{ fontWeight: 700, mb: 1 }}>Network sent (sent_bytes_count)</Typography>
                                {networkSentChart && networkSentChart.lines.length > 0 ? (
                                    <Box sx={{ mb: 2 }}>
                                        <LineChart<MonitoringMultiLineChartData>
                                            key={`net-tx-${monitoringChartKey}`}
                                            title='Network bytes sent (GiB)'
                                            charts={networkSentChart.charts}
                                            colors={networkSentChart.colors}
                                            lines={networkSentChart.lines}
                                            yAxisLabels={Y_AXIS_LABEL_NETWORK}
                                            legend={MONITORING_CHART_LEGEND}
                                            grid={MONITORING_CHART_GRID}
                                            height={MONITORING_CHART_HEIGHT}
                                            xAxis={monitoringChartXAxis}
                                            chartValueFormatter={value => {
                                                const y =
                                                    Array.isArray(value) ? extractNumber(value[1]) : extractNumber(value);
                                                return y === null ? '-' : y.toFixed(3);
                                            }}
                                        />
                                    </Box>
                                ) : (
                                    <Typography variant='body2' color='text.secondary' sx={{ mb: 2 }}>
                                        No network sent points parsed for a chart.
                                    </Typography>
                                )}
                                <CollapsibleRawJson data={response.networkSentBytes} />
                            </Box>
                        </Box>
                    </Paper>
                )}
            </Box>
        </LocalizationProvider>
    );
}