export interface BlockPatchState {
  on: boolean;
  typeId: number;
  /** paramId -> real-world value (range params) or option index (enum params). */
  params: Record<string, number>;
}

export type PatchState = Record<string, BlockPatchState>;

export interface PresetEntry {
  id: string;
  name: string;
  patch: PatchState;
  createdAt: number;
  updatedAt: number;
}
