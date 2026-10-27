export const ORGANIZATION_CATEGORIES = {
  application: '신청·진행',
  medical: '진료·치료',
  employment: '직장·고용보험',
  payments: '비용·지급',
  correspondence: '연락·기관 회신',
  other: '기타 자료',
} as const;
export type OrganizationCategory = keyof typeof ORGANIZATION_CATEGORIES;
export interface OrganizationProposal { documentId: string; category: OrganizationCategory }
export function validateOrganization(value: unknown): OrganizationProposal[] {
  if (!Array.isArray(value) || !value.length || value.length > 20) throw Error('INVALID_ORGANIZATION');
  const ids = new Set<string>();
  return value.map(item => {
    if (!item || typeof item !== 'object' || Object.keys(item).some(key => !['documentId','category'].includes(key)) ||
      typeof item.documentId !== 'string' || !/^[A-Za-z0-9-]{8,80}$/.test(item.documentId) || ids.has(item.documentId) ||
      typeof item.category !== 'string' || !Object.hasOwn(ORGANIZATION_CATEGORIES, item.category)) throw Error('INVALID_ORGANIZATION');
    ids.add(item.documentId);
    return { documentId: item.documentId, category: item.category as OrganizationCategory };
  });
}
