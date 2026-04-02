export interface ILine<ChartType> {
  name: string;
  key: keyof ChartType;
  stack?: string;
  areaStyle?: { [key: string]: any };
  yAxisIndex?: number;
}

export interface ILineChart<ChartType> {
  charts: ChartType;
  title: string;
  lines: ILine<ChartType>[];
  colors?: string[];
  chartValueFormatter?: (value?: any) => string | number;
  splitAxis?: boolean;
  yAxisLabels?: string | [string, string];
  grid?: any;
  xAxis?: any;
  scatterplot?: boolean;
  /** Merged into ECharts `legend` (e.g. `{ type: 'scroll' }` for many series). */
  legend?: Record<string, unknown>;
  /** Chart height in pixels (default 300). */
  height?: number;
}

export interface ILineChartZoomEvent {
  batch?: { start: number; startValue: number; end: number }[];
}

export interface ILineChartMarkers {
  markers?: string[];
}

export interface ILineChartTimeAxis {
  time: string[];
}

export interface ILineChartTooltipFormatterParams {
  axisValue: string;
  color: string;
  seriesName: string;
  value: string | number | [string, number];
}
