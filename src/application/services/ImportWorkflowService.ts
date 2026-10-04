import type { EntityId } from '../../domain/common';
import type { ImportResolution } from '../../domain/models';
import type { ImportMatchActions, ImportReviewActions } from '../contracts/actions';
import type { ImportRepository, PersonRepository } from '../contracts/repositories';

export class ImportWorkflowService implements ImportMatchActions, ImportReviewActions {
  constructor(
    private readonly imports: ImportRepository,
    private readonly people: PersonRepository,
  ) {}

  async cyclePersonMatch(batchId: EntityId, detectedPersonId: EntityId): Promise<void> {
    const batch = await this.imports.getBatch(batchId);
    if (!batch) throw new Error('Import batch was not found.');

    const detected = batch.detectedPeople.find((item) => item.id === detectedPersonId);
    if (!detected) throw new Error('Detected person was not found.');

    const people = await this.people.list();
    const options: Array<EntityId | null> = [null, ...people.map((person) => person.id)];
    const index = options.findIndex((personId) => personId === detected.matchedPersonId);
    const next = options[(index + 1 + options.length) % options.length] ?? null;
    await this.imports.setDetectedPersonMatch(batchId, detectedPersonId, next);
  }

  setResolution(batchId: EntityId, reviewItemId: EntityId, resolution: ImportResolution): Promise<void> {
    return this.imports.setResolution(batchId, reviewItemId, resolution);
  }
}
