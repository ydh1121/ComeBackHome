import type { ApprovedWorkbookImportGateway, ApprovedWorkbookImportReceipt } from '../../application/contracts/repositories';
import { HttpJsonClient } from './HttpJsonClient';

export class HttpApprovedWorkbookImportGateway implements ApprovedWorkbookImportGateway {
  constructor(private readonly client: HttpJsonClient) {}
  async commit(payload: unknown): Promise<ApprovedWorkbookImportReceipt> {
    const response = await this.client.put<{receipt: ApprovedWorkbookImportReceipt}>(
      '/workbooks/approved-import', payload,
    );
    if (!response.receipt || response.receipt.applied !== true) {
      throw new Error('APPROVED_WORKBOOK_IMPORT_RECEIPT_INVALID');
    }
    return response.receipt;
  }
}
