// Copyright (C) 2026 The Android Open Source Project
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import type {CellFormatter} from '../../../../components/widgets/datagrid/datagrid_schema';
import {Duration, Time} from '../../../../base/time';
import type {Trace} from '../../../../public/trace';
import {TimestampFormat} from '../../../../public/timeline';
import {
  underlyingSqlType,
  type PerfettoSqlType,
} from '../../../../trace_processor/perfetto_sql_type';
import type {ChartColumnProvider} from './chart_renderers';

/**
 * Whether a column's underlying SQL type is INTEGER.
 */
export function isIntegerColumn(
  node: ChartColumnProvider,
  columnName: string,
): boolean {
  const columnInfo = node.sourceCols.find((col) => col.name === columnName);
  const columnType = columnInfo?.type;
  return (
    columnType !== undefined && underlyingSqlType(columnType) === 'INTEGER'
  );
}

/**
 * Get the PerfettoSQL type kind for a column, if available.
 */
export function getColumnTypeKind(
  node: ChartColumnProvider,
  columnName: string,
): PerfettoSqlType['kind'] | undefined {
  const columnInfo = node.sourceCols.find((col) => col.name === columnName);
  return columnInfo?.type?.kind;
}

/**
 * Create a numeric formatter for timestamp/duration columns.
 * Returns undefined if the column doesn't need special formatting.
 */
export function getNumericFormatter(
  node: ChartColumnProvider,
  columnName: string,
  trace?: Trace,
): ((value: number) => string) | undefined {
  const kind = getColumnTypeKind(node, columnName);
  if (kind === 'timestamp' && trace !== undefined) {
    return (value: number) => formatTimestamp(trace, value);
  }
  if (kind === 'timestamp' || kind === 'duration') {
    return (value: number) => Duration.humanise(BigInt(Math.round(value)));
  }
  return undefined;
}

/**
 * Build a map of CellFormatters for columns that need special formatting
 * (e.g., timestamp/duration columns).
 */
export function buildCellFormatters(
  node: ChartColumnProvider,
  columns: readonly string[],
): Record<string, CellFormatter> | undefined {
  const formatters: Record<string, CellFormatter> = {};
  let hasAny = false;
  for (const col of columns) {
    const kind = getColumnTypeKind(node, col);
    if (kind === 'timestamp' || kind === 'duration') {
      formatters[col] = (value) => {
        if (typeof value === 'number') {
          return Duration.humanise(BigInt(Math.round(value)));
        }
        if (typeof value === 'bigint') {
          return Duration.humanise(value);
        }
        return String(value ?? '');
      };
      hasAny = true;
    }
  }
  return hasAny ? formatters : undefined;
}

/**
 * Formats a trace timestamp the way the timeline does, following the user's
 * timestamp format setting: e.g. wall-clock time of day for UTC or a custom
 * timezone, or time since trace start for timecode.
 */
export function formatTimestamp(trace: Trace, value: number): string {
  const ts = Time.fromRaw(BigInt(Math.round(value)));
  const fmt = trace.timeline.timestampFormat;
  switch (fmt) {
    case TimestampFormat.UTC:
    case TimestampFormat.TraceTz:
    case TimestampFormat.CustomTimezone:
    case TimestampFormat.Timecode: {
      // Whole seconds (e.g. axis ticks) are shown without milliseconds.
      const tc = Time.toTimecode(trace.timeline.toDomainTime(ts));
      return tc.millis === '000' ? tc.dhhmmss : `${tc.dhhmmss}.${tc.millis}`;
    }
    case TimestampFormat.TraceNs:
      return ts.toString();
    case TimestampFormat.TraceNsLocale:
      return ts.toLocaleString();
    case TimestampFormat.Seconds:
      return Time.formatSeconds(trace.timeline.toDomainTime(ts));
    case TimestampFormat.Milliseconds:
      return Time.formatMilliseconds(trace.timeline.toDomainTime(ts));
    case TimestampFormat.Microseconds:
      return Time.formatMicroseconds(trace.timeline.toDomainTime(ts));
  }
}
