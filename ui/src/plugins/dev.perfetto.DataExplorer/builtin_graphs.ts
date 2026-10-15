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

// Optional built-in tabs supplied by the hosting server at runtime. The server
// lists them in <BASE>/index.json; each entry names a whole-tab export (graph
// plus dashboards) in the same directory. When the server has no manifest the
// navigation panel shows no section, so a plain UI build is unaffected.

import m from 'mithril';
import {z} from 'zod';

const BUILTIN_GRAPHS_PATH = '/api/data-explorer/builtin';

const BUILTIN_GRAPH_SCHEMA = z.object({
  name: z.string(),
  description: z.string(),
  icon: z.string().default('auto_stories'),
  file: z.string().regex(/^[A-Za-z0-9_-]+\.json$/),
});

const BUILTIN_GRAPHS_MANIFEST_SCHEMA = z.object({
  title: z.string(),
  graphs: z.array(BUILTIN_GRAPH_SCHEMA),
});

export type BuiltinGraph = z.infer<typeof BUILTIN_GRAPH_SCHEMA>;
export type BuiltinGraphsManifest = z.infer<
  typeof BUILTIN_GRAPHS_MANIFEST_SCHEMA
>;

let manifest: BuiltinGraphsManifest | undefined;
let requested = false;

// Returns the manifest once it has loaded. The first call starts the fetch and
// schedules a redraw when it completes.
export function getBuiltinGraphs(): BuiltinGraphsManifest | undefined {
  if (!requested) {
    requested = true;
    void fetchManifest();
  }
  return manifest;
}

export function builtinGraphUrl(graph: BuiltinGraph): string {
  return new URL(`${BUILTIN_GRAPHS_PATH}/${graph.file}`, self.location.origin)
    .href;
}

async function fetchManifest(): Promise<void> {
  try {
    const url = new URL(
      `${BUILTIN_GRAPHS_PATH}/index.json`,
      self.location.origin,
    );
    const response = await fetch(url, {cache: 'no-cache'});
    if (!response.ok) return;
    const parsed = BUILTIN_GRAPHS_MANIFEST_SCHEMA.safeParse(
      await response.json(),
    );
    if (!parsed.success) {
      console.warn('Ignoring invalid built-in graphs manifest:', parsed.error);
      return;
    }
    if (parsed.data.graphs.length === 0) return;
    manifest = parsed.data;
    m.redraw();
  } catch (e) {
    console.debug('No built-in graphs available:', e);
  }
}
