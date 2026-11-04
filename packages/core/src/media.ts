export type AssetUsage = {
  storyId: string;
  storyName: string;
  folderId: string | null;
  localeId: string;
  localeSlug: string;
  localeName: string;
  spaceLocaleId: string;
  blockId: string;
  definitionId: string;
  blockName: string;
  fieldId: string;
  fieldName: string;
  fieldLabel: string;
  state: 'draft' | 'published';
};
export type AssetUsagePage = { items: AssetUsage[]; nextCursor: string | null };
