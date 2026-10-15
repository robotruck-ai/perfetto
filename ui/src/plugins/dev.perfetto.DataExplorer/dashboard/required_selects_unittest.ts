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
} from './dashboard_registry';
import {pendingRequiredSelect} from './required_selects';

function source(nodeId: string, columns: string[]): DashboardDataSource {
  return {
    name: nodeId,
    nodeId,
    graphId: 'graph',
    columns: columns.map((name) => ({name})),
  };
}

const SOURCES = [
  source('channels', ['channel']),
  source('latency', ['channel', 'latency_ms']),
  source('callbacks', ['component', 'dur_ms']),
];

function select(required: boolean): DashboardItem {
  return {
    kind: 'select',
    id: 'select',
    sourceNodeId: 'channels',
    column: 'channel',
    label: 'Channel',
    required,
  };
}

describe('pendingRequiredSelect', () => {
  it('holds back sources filtered by a required dropdown without a value', () => {
    const pending = pendingRequiredSelect([select(true)], SOURCES, new Map(), [
      'latency',
    ]);
    expect(pending?.label).toBe('Channel');
  });

  it('releases them once the dropdown has a value', () => {
    const filters = new Map<string, DashboardBrushFilter[]>([
      ['channels', [{column: 'channel', op: '=', value: '/a'}]],
    ]);
    expect(
      pendingRequiredSelect([select(true)], SOURCES, filters, ['latency']),
    ).toBeUndefined();
  });

  it('ignores sources without the dropdown column', () => {
    expect(
      pendingRequiredSelect([select(true)], SOURCES, new Map(), ['callbacks']),
    ).toBeUndefined();
  });

  it('holds back sources whose columns are not known yet', () => {
    const sources = [...SOURCES, source('unexecuted', [])];
    const pending = pendingRequiredSelect([select(true)], sources, new Map(), [
      'unexecuted',
    ]);
    expect(pending?.label).toBe('Channel');
  });

  it('ignores optional dropdowns', () => {
    expect(
      pendingRequiredSelect([select(false)], SOURCES, new Map(), ['latency']),
    ).toBeUndefined();
  });
});
