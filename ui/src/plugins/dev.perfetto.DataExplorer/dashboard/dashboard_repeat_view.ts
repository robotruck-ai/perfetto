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

import m from 'mithril';
import type {Trace} from '../../../public/trace';
import {type SqlValue, UNKNOWN} from '../../../trace_processor/query_result';
import {getDefaultChartLabel} from '../query_builder/nodes/visualisation_node';
import {DashboardChartView, buildWhereClause} from './dashboard_chart_view';
import type {
  DashboardBrushFilter,
  DashboardDataSource,
  DashboardItem,
  DashboardRepeat,
  DashboardRepeatSection,
} from './dashboard_registry';

// Upper bound on the number of groups rendered per section.
const MAX_GROUPS = 500;

export interface DashboardRepeatViewAttrs {
  readonly trace: Trace;
  readonly dashboardId: string;
  readonly repeat: DashboardRepeat;
  readonly items: DashboardItem[];
  readonly allSources: ReadonlyArray<DashboardDataSource>;
  readonly brushFilters: Map<string, DashboardBrushFilter[]>;
  readonly gridLines?: 'horizontal' | 'vertical' | 'both';
  // Reports the natural height of the content so the card can grow to fit.
  readonly onContentHeight: (px: number) => void;
}

interface SectionValues {
  readonly key: string;
  values?: SqlValue[];
  error?: string;
}

/**
 * Renders a DashboardRepeat: for each section, one group of charts per
 * distinct value of the section's column. Every chart in a group is filtered
 * to that value on top of the dashboard's own filters.
 */
export class DashboardRepeatView implements m.ClassComponent<DashboardRepeatViewAttrs> {
  private readonly sectionValues = new Map<number, SectionValues>();
  private readonly executionRequested = new Set<string>();

  view({attrs}: m.CVnode<DashboardRepeatViewAttrs>) {
    return m(
      '.pf-dashboard__repeat',
      attrs.repeat.sections.map((section, i) =>
        this.renderSection(attrs, section, i),
      ),
    );
  }

  oncreate(vnode: m.VnodeDOM<DashboardRepeatViewAttrs>) {
    vnode.attrs.onContentHeight((vnode.dom as HTMLElement).scrollHeight);
  }

  onupdate(vnode: m.VnodeDOM<DashboardRepeatViewAttrs>) {
    vnode.attrs.onContentHeight((vnode.dom as HTMLElement).scrollHeight);
  }

  private renderSection(
    attrs: DashboardRepeatViewAttrs,
    section: DashboardRepeatSection,
    index: number,
  ): m.Child {
    const header = m('.pf-dashboard__repeat-title', section.title);
    const source = attrs.allSources.find(
      (s) => s.nodeId === section.sourceNodeId,
    );
    if (source === undefined) {
      return m('.pf-dashboard__repeat-section', [
        header,
        renderStatus('Data source removed'),
      ]);
    }
    const values = this.getValues(attrs, section, index, source);
    let body: m.Children;
    if (values === undefined) {
      body = renderStatus('Loading…');
    } else if (typeof values === 'string') {
      body = renderStatus(values);
    } else if (values.length === 0) {
      body = renderStatus('Nothing to show for the current selection.');
    } else {
      // One extra value is loaded to tell whether the list was cut short.
      body = [
        values.length > MAX_GROUPS &&
          renderStatus(`Showing the first ${MAX_GROUPS} values only.`),
        values
          .slice(0, MAX_GROUPS)
          .map((value) => this.renderGroup(attrs, section, index, value)),
      ];
    }
    return m('.pf-dashboard__repeat-section', [header, body]);
  }

  private renderGroup(
    attrs: DashboardRepeatViewAttrs,
    section: DashboardRepeatSection,
    sectionIndex: number,
    value: SqlValue,
  ): m.Child {
    const valueText = value === null ? 'NULL' : String(value);
    const valueFilter: DashboardBrushFilter =
      value === null
        ? {column: section.column, op: 'is null'}
        : {column: section.column, op: '=', value};
    return m(
      '.pf-dashboard__repeat-group',
      {key: `${sectionIndex}|${valueText}`},
      [
        m('.pf-dashboard__repeat-group-title', valueText),
        m(
          '.pf-dashboard__repeat-group-charts',
          {
            style: `grid-template-columns: repeat(${section.charts.length}, 1fr)`,
          },
          section.charts.map((tmpl) => {
            const source = attrs.allSources.find(
              (s) => s.nodeId === tmpl.sourceNodeId,
            );
            const title = tmpl.config.name ?? getDefaultChartLabel(tmpl.config);
            let content: m.Children;
            if (source === undefined) {
              content = renderStatus('Data source removed');
            } else {
              // Narrow the dashboard's filters on this source to the group's
              // value. Brushing inside a repeated chart is not propagated.
              const filters = new Map(attrs.brushFilters);
              filters.set(source.nodeId, [
                ...(attrs.brushFilters.get(source.nodeId) ?? []).filter(
                  (f) => f.column !== section.column,
                ),
                valueFilter,
              ]);
              content = m(DashboardChartView, {
                trace: attrs.trace,
                source,
                config: tmpl.config,
                dashboardId: attrs.dashboardId,
                items: attrs.items,
                allSources: attrs.allSources,
                brushFilters: filters,
                onItemsChange: () => {},
                onBrushFiltersChange: () => {},
                gridLines: attrs.gridLines,
              });
            }
            return m('.pf-dashboard__repeat-chart', [
              m('.pf-dashboard__repeat-chart-title', title),
              m('.pf-dashboard__chart-content', content),
            ]);
          }),
        ),
      ],
    );
  }

  // Distinct values of the section's column under the dashboard's filters on
  // its source. Undefined while loading, a string on error.
  private getValues(
    attrs: DashboardRepeatViewAttrs,
    section: DashboardRepeatSection,
    index: number,
    source: DashboardDataSource,
  ): SqlValue[] | string | undefined {
    if (source.tableName === undefined || source.columns.length === 0) {
      this.requestExecution(source);
      return undefined;
    }
    if (!source.columns.some((c) => c.name === section.column)) {
      return `Column "${section.column}" not found in ${source.name}.`;
    }
    const validColumns = new Set(source.columns.map((c) => c.name));
    const filters = (attrs.brushFilters.get(source.nodeId) ?? []).filter((f) =>
      validColumns.has(f.column),
    );
    const key = `${source.tableName}|${section.column}|${JSON.stringify(filters)}`;
    let entry = this.sectionValues.get(index);
    if (entry === undefined || entry.key !== key) {
      entry = {key};
      this.sectionValues.set(index, entry);
      void this.loadValues(
        attrs.trace,
        `SELECT DISTINCT ${section.column} AS value FROM ${source.tableName}` +
          `${buildWhereClause(filters)} ORDER BY value LIMIT ${MAX_GROUPS + 1}`,
        entry,
      );
    }
    return entry.error ?? entry.values;
  }

  private async loadValues(
    trace: Trace,
    query: string,
    entry: SectionValues,
  ): Promise<void> {
    try {
      const result = await trace.engine.query(query);
      const values: SqlValue[] = [];
      for (const it = result.iter({value: UNKNOWN}); it.valid(); it.next()) {
        values.push(it.value);
      }
      entry.values = values;
    } catch (e) {
      entry.error = e instanceof Error ? e.message : String(e);
    }
    m.redraw();
  }

  private requestExecution(source: DashboardDataSource): void {
    if (
      this.executionRequested.has(source.nodeId) ||
      source.requestExecution === undefined
    ) {
      return;
    }
    this.executionRequested.add(source.nodeId);
    source
      .requestExecution()
      .catch((e) => console.debug('Dashboard source execution failed:', e))
      .finally(() => this.executionRequested.delete(source.nodeId));
  }
}

function renderStatus(text: string): m.Children {
  return m('.pf-dashboard__select-status', text);
}
