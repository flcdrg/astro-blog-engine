import { mappingsSchema, stateSchema, type Mappings, type PublishingState } from "../../src/scripts/social/schema.ts";

export function mergeProgress(
  main: { mappings: Mappings; state: PublishingState },
  outstanding: { mappings: Mappings; state: PublishingState },
) {
  const operations = { ...outstanding.state.operations };
  for (const [id, providers] of Object.entries(main.state.operations)) {
    operations[id] = { ...operations[id], ...providers };
  }
  const mappings = { ...outstanding.mappings };
  for (const [id, mapping] of Object.entries(main.mappings)) mappings[id] = { ...mappings[id], ...mapping };
  return {
    mappings: mappingsSchema.parse(mappings),
    state: stateSchema.parse({
      ...outstanding.state,
      baseline: main.state.baseline ?? outstanding.state.baseline,
      operations,
    }),
  };
}
