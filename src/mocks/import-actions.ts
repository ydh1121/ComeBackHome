import type { ImportFileSelectionAction, ImportInputFile } from '../application/contracts/actions';
import type { ImportRepository } from '../application/contracts/repositories';
import type { ImportFileRecord } from '../domain/models';

export class MockImportFileSelectionAction implements ImportFileSelectionAction {
  constructor(private readonly imports: ImportRepository) {}

  async accept(files: ImportInputFile[]): Promise<string> {
    const batch = await this.imports.getCurrentBatch();
    if (!batch) throw new Error('Import batch was not found.');

    const records: ImportFileRecord[] = files.map(({ kind, file }) => ({
      id: crypto.randomUUID(),
      name: file.name,
      kind: kind === 'WORKBOOK' ? 'XLSX' : 'IMAGE',
      progress: 100,
      status: 'READY',
    }));

    await this.imports.replaceFiles(batch.id, records);
    return batch.id;
  }
}
