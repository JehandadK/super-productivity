import {
  ActionType,
  Operation,
  OperationLogEntry,
  OpType,
} from '../core/operation.types';
import {
  MAX_LISTED_LOCAL_CHANGES,
  summarizePendingOps,
} from './sync-import-conflict-change-summary.util';

describe('summarizePendingOps', () => {
  let seq = 0;

  const entry = (overrides: Partial<Operation>): OperationLogEntry => ({
    seq: ++seq,
    appliedAt: 1,
    source: 'local',
    op: {
      id: `op-${seq}`,
      actionType: ActionType.TASK_SHARED_UPDATE,
      opType: OpType.Update,
      entityType: 'TASK',
      entityId: 'task-1',
      payload: {},
      clientId: 'client-A',
      vectorClock: { clientA: seq },
      timestamp: 1,
      schemaVersion: 1,
      ...overrides,
    },
  });

  beforeEach(() => {
    seq = 0;
  });

  it('should return undefined when there is nothing to list', () => {
    expect(summarizePendingOps([])).toBeUndefined();
  });

  it('should return undefined above the listing limit', () => {
    const entries = Array.from({ length: MAX_LISTED_LOCAL_CHANGES + 1 }, (_, i) =>
      entry({ entityId: `task-${i}` }),
    );

    expect(summarizePendingOps(entries)).toBeUndefined();
  });

  it('should list exactly at the limit', () => {
    const entries = Array.from({ length: MAX_LISTED_LOCAL_CHANGES }, (_, i) =>
      entry({ entityId: `task-${i}` }),
    );

    expect(summarizePendingOps(entries)?.length).toBe(MAX_LISTED_LOCAL_CHANGES);
  });

  it('should read the title of a created task', () => {
    const result = summarizePendingOps([
      entry({
        actionType: ActionType.TASK_SHARED_ADD,
        opType: OpType.Create,
        payload: {
          entityChanges: [],
          actionPayload: { task: { id: 'task-1', title: 'Buy milk' } },
        },
      }),
    ]);

    expect(result).toEqual([
      { entityType: 'TASK', entityId: 'task-1', kind: 'CREATED', label: 'Buy milk' },
    ]);
  });

  it('should merge several edits of one task into one row with the newest title and the touched fields', () => {
    const result = summarizePendingOps([
      entry({
        payload: {
          entityChanges: [],
          actionPayload: { task: { id: 'task-1', changes: { title: 'Old title' } } },
        },
      }),
      entry({
        payload: {
          entityChanges: [],
          actionPayload: {
            task: { id: 'task-1', changes: { title: 'New title', isDone: true } },
          },
        },
      }),
    ]);

    expect(result).toEqual([
      {
        entityType: 'TASK',
        entityId: 'task-1',
        kind: 'UPDATED',
        label: 'New title',
        fields: ['title', 'isDone'],
      },
    ]);
  });

  it('should not report bookkeeping fields as edits', () => {
    const result = summarizePendingOps([
      entry({
        payload: {
          entityChanges: [],
          actionPayload: { task: { id: 'task-1', changes: { modified: 5, notes: 'x' } } },
        },
      }),
    ]);

    expect(result?.[0].fields).toEqual(['notes']);
  });

  it('should report a delete over a create or update of the same entity', () => {
    const result = summarizePendingOps([
      entry({ opType: OpType.Update }),
      entry({ opType: OpType.Delete }),
    ]);

    expect(result?.[0].kind).toBe('DELETED');
  });

  it('should expand a bulk op into a row per entity without guessing labels', () => {
    const result = summarizePendingOps([
      entry({
        opType: OpType.Delete,
        entityId: undefined,
        entityIds: ['task-1', 'task-2'],
        payload: {
          entityChanges: [],
          actionPayload: { task: { id: 'task-1', title: 'Only the first' } },
        },
      }),
    ]);

    expect(result).toEqual([
      { entityType: 'TASK', entityId: 'task-1', kind: 'DELETED' },
      { entityType: 'TASK', entityId: 'task-2', kind: 'DELETED' },
    ]);
  });

  it('should report a pending full-state op as an import', () => {
    const result = summarizePendingOps([
      entry({
        actionType: ActionType.LOAD_ALL_DATA,
        opType: OpType.BackupImport,
        entityType: 'ALL',
        entityId: undefined,
      }),
    ]);

    expect(result).toEqual([{ entityType: 'ALL', kind: 'IMPORTED' }]);
  });

  it('should keep different entity types with the same id apart', () => {
    const result = summarizePendingOps([
      entry({ entityType: 'TASK', entityId: 'x' }),
      entry({ entityType: 'NOTE', entityId: 'x' }),
    ]);

    expect(result?.map((c) => c.entityType)).toEqual(['TASK', 'NOTE']);
  });

  it('should read a name for entities that have no title', () => {
    const result = summarizePendingOps([
      entry({
        entityType: 'TAG',
        entityId: 'tag-1',
        opType: OpType.Create,
        payload: {
          entityChanges: [],
          actionPayload: { tag: { id: 'tag-1', name: 'Errands' } },
        },
      }),
    ]);

    expect(result?.[0].label).toBe('Errands');
  });

  it('should tolerate payloads that are not objects', () => {
    const result = summarizePendingOps([entry({ payload: null as unknown })]);

    expect(result).toEqual([{ entityType: 'TASK', entityId: 'task-1', kind: 'UPDATED' }]);
  });
});
