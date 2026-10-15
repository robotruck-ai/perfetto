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

import type {
  DashboardBrushFilter,
  DashboardDataSource,
  DashboardItem,
  DashboardSelect,
} from './dashboard_registry';

/**
 * The first required dropdown that filters one of `sourceNodeIds` but has no
 * value yet, if any.
 *
 * A required dropdown picks its first value once its own source has loaded.
 * Until then, charts on the sources it filters (the sources with its column)
 * wait for it: querying them unfiltered would scan whole sources only to be
 * thrown away, and delay everything else queued on the trace processor.
 * Sources whose columns are not known yet (not executed) may have the column,
 * so they wait too.
 */
export function pendingRequiredSelect(
  items: ReadonlyArray<DashboardItem>,
  sources: ReadonlyArray<DashboardDataSource>,
  brushFilters: ReadonlyMap<string, ReadonlyArray<DashboardBrushFilter>>,
  sourceNodeIds: ReadonlyArray<string>,
): DashboardSelect | undefined {
  for (const item of items) {
    if (item.kind !== 'select' || item.required !== true) continue;
    const selected = (brushFilters.get(item.sourceNodeId) ?? []).some(
      (f) => f.column === item.column,
    );
    if (selected) continue;
    const filtered = sourceNodeIds.some((id) => {
      if (id === item.sourceNodeId) return true;
      const columns = sources.find((s) => s.nodeId === id)?.columns ?? [];
      return (
        columns.length === 0 || columns.some((c) => c.name === item.column)
      );
    });
    if (filtered) return item;
  }
  return undefined;
}
