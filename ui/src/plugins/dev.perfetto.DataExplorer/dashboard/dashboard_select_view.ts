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
import {Combobox} from '../../../widgets/combobox';
import {
  type DashboardBrushFilter,
  type DashboardDataSource,
  type DashboardSelect,
  getLinkedSourceNodeIds,
} from './dashboard_registry';

// Upper bound on the number of distinct values offered in the dropdown.
const MAX_OPTIONS = 1000;
// Suggestion that clears the selection (only offered when not required).
const ALL_OPTION = '(All)';

export interface DashboardSelectViewAttrs {
  readonly trace: Trace;
  readonly source: DashboardDataSource;
  readonly select: DashboardSelect;
  readonly allSources: ReadonlyArray<DashboardDataSource>;
  readonly brushFilters: Map<string, DashboardBrushFilter[]>;
  readonly onBrushFiltersChange: (
    filters: Map<string, DashboardBrushFilter[]>,
  ) => void;
}

/**
 * Renders a DashboardSelect: a searchable dropdown of the distinct values of
 * one column. The selection is stored as brush filters, so it filters every
 * chart on the dashboard whose source has a column with the same name.
 */
export class DashboardSelectView implements m.ClassComponent<DashboardSelectViewAttrs> {
  private executionRequested = false;
  // Identifies the table and column the loaded values belong to.
  private loadedKey?: string;
  private values?: SqlValue[];
  private error?: string;
  private latestAttrs?: DashboardSelectViewAttrs;
  private syncPending = false;
  // Text in the search box, and the selection it was last reset to.
  private query = '';
  private lastSelectedText?: string;

  view({attrs}: m.CVnode<DashboardSelectViewAttrs>) {
    this.latestAttrs = attrs;
    const {source, select} = attrs;

    // Sources whose schema is only known after execution (e.g. SQL sources)
    // report no columns until they have run.
    if (source.tableName === undefined || source.columns.length === 0) {
      this.requestExecution(source);
      return renderStatus('Loading data…');
    }
    if (!source.columns.some((c) => c.name === select.column)) {
      return renderStatus(`Column "${select.column}" not found`, true);
    }

    const key = `${source.tableName}|${select.column}`;
    if (this.loadedKey !== key) {
      this.loadedKey = key;
      this.values = undefined;
      this.error = undefined;
      void this.loadValues(attrs.trace, source.tableName, select.column, key);
    }
    if (this.error !== undefined) {
      return renderStatus(`Failed to load values: ${this.error}`, true);
    }
    if (this.values === undefined) {
      return renderStatus('Loading values…');
    }

    const values = this.values;
    const selected = currentSelection(attrs);
    this.syncLinkedSources(attrs, selected);

    // The input doubles as a search box: typing filters the suggestions, and
    // only an exact match of a value (picked from the list or typed in full)
    // changes the selection. Reset the text whenever the selection changes,
    // including from outside (e.g. the filter bar).
    const selectedText =
      selected !== undefined
        ? formatValue(selected)
        : select.required
          ? ''
          : ALL_OPTION;
    if (selectedText !== this.lastSelectedText) {
      this.lastSelectedText = selectedText;
      this.query = selectedText;
    }
    const byText = new Map(values.map((v) => [formatValue(v), v]));
    return m(Combobox, {
      className: 'pf-dashboard__select',
      icon: 'search',
      placeholder: `Search ${values.length} values`,
      value: this.query,
      suggestions: [...(select.required ? [] : [ALL_OPTION]), ...byText.keys()],
      onChange: (text: string) => {
        this.query = text;
        if (text === ALL_OPTION && !select.required) {
          setSelection(attrs, undefined);
        } else if (byText.has(text)) {
          setSelection(attrs, byText.get(text));
        }
      },
    });
  }

  // Other sources sharing the column publish their columns only once they
  // have run, which can be after the selection was made. Extend the selection
  // to them as they appear so that no chart shows unfiltered data.
  private syncLinkedSources(
    attrs: DashboardSelectViewAttrs,
    selected: SqlValue | undefined,
  ): void {
    if (selected === undefined || this.syncPending) return;
    const column = attrs.select.column;
    const outOfSync = getLinkedSourceNodeIds(
      attrs.allSources,
      attrs.source.nodeId,
      column,
    ).some(
      (id) => selectionOf(attrs.brushFilters.get(id), column) !== selected,
    );
    if (!outOfSync) return;
    this.syncPending = true;
    // Defer the update: it must not happen while rendering.
    setTimeout(() => {
      this.syncPending = false;
      const latest = this.latestAttrs;
      if (latest === undefined) return;
      const current = currentSelection(latest);
      if (current !== undefined) setSelection(latest, current);
    }, 0);
  }

  private requestExecution(source: DashboardDataSource): void {
    if (this.executionRequested || source.requestExecution === undefined) {
      return;
    }
    this.executionRequested = true;
    source
      .requestExecution()
      .catch((e) => console.debug('Dashboard source execution failed:', e))
      .finally(() => {
        this.executionRequested = false;
      });
  }

  private async loadValues(
    trace: Trace,
    tableName: string,
    column: string,
    key: string,
  ): Promise<void> {
    try {
      const result = await trace.engine.query(
        `SELECT DISTINCT ${column} AS value FROM ${tableName} ` +
          `ORDER BY value LIMIT ${MAX_OPTIONS}`,
      );
      const values: SqlValue[] = [];
      for (const it = result.iter({value: UNKNOWN}); it.valid(); it.next()) {
        values.push(it.value);
      }
      if (this.loadedKey !== key) return;
      this.values = values;
      // A required dropdown must always hold a value: default to the first.
      const attrs = this.latestAttrs;
      if (
        attrs !== undefined &&
        attrs.select.required &&
        values.length > 0 &&
        !values.includes(currentSelection(attrs) ?? null)
      ) {
        setSelection(attrs, values[0]);
      }
    } catch (e) {
      if (this.loadedKey !== key) return;
      this.error = e instanceof Error ? e.message : String(e);
    }
    m.redraw();
  }
}

function formatValue(value: SqlValue): string {
  return value === null ? 'NULL' : String(value);
}

function renderStatus(text: string, isError = false): m.Children {
  return m(
    '.pf-dashboard__select-status',
    {className: isError ? 'pf-dashboard__select-status--error' : undefined},
    text,
  );
}

// The single value selected on `column` by a source's brush filters.
// Undefined unless exactly one value is selected.
function selectionOf(
  filters: ReadonlyArray<DashboardBrushFilter> | undefined,
  column: string,
): SqlValue | undefined {
  const forColumn = (filters ?? []).filter((f) => f.column === column);
  if (forColumn.length !== 1) return undefined;
  const f = forColumn[0];
  if (f.op === 'is null') return null;
  if (f.op === '=') return f.value;
  return undefined;
}

// The value selected in the dropdown, read back from its source's filters.
function currentSelection(
  attrs: DashboardSelectViewAttrs,
): SqlValue | undefined {
  return selectionOf(
    attrs.brushFilters.get(attrs.source.nodeId),
    attrs.select.column,
  );
}

// Replaces the filters on the dropdown's column, in its own source and in all
// sources sharing the column name. `undefined` clears the selection.
function setSelection(
  attrs: DashboardSelectViewAttrs,
  value: SqlValue | undefined,
): void {
  const column = attrs.select.column;
  const newFilters = new Map(attrs.brushFilters);
  for (const id of getLinkedSourceNodeIds(
    attrs.allSources,
    attrs.source.nodeId,
    column,
  )) {
    const retained = (newFilters.get(id) ?? []).filter(
      (f) => f.column !== column,
    );
    if (value !== undefined) {
      retained.push(
        value === null ? {column, op: 'is null'} : {column, op: '=', value},
      );
    }
    if (retained.length === 0) {
      newFilters.delete(id);
    } else {
      newFilters.set(id, retained);
    }
  }
  attrs.onBrushFiltersChange(newFilters);
}
