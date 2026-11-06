# Local tag-restriction cleanup

> Historical local operation record. The status below is as recorded on the date
> of the operation. For current nesting and release guidance, use the
> [production/dev workflow](development-workflow.md).

On 2026-11-05, field-level `allowedTags` references were removed from current local schema workspaces through the existing versioned save API. Definition tags and immutable deployed history were retained. These edits are staged in the active schema migration; they have not been deployed.

Fields without explicit allowed block IDs now allow every nestable and universal definition after deployment. Review the affected fields in the CMS and select specific blocks before deploying if needed. No story content was deleted.

| Space    | Block                | Field | Removed tags    | Allowed before | Allowed after | Previously allowed blocks |
| -------- | -------------------- | ----- | --------------- | -------------: | ------------: | ------------------------- |
| My space | tagged_page_472391cb | body  | layout-472391cb |              1 |            44 | tagged_feature_472391cb   |
| My space | tagged_page_7ba88ba4 | body  | layout-7ba88ba4 |              1 |            44 | tagged_feature_7ba88ba4   |
| My space | tagged_page_8988ef91 | body  | layout-8988ef91 |              1 |            44 | tagged_feature_8988ef91   |
| My space | tagged_page_9bf85911 | body  | layout-9bf85911 |              1 |            44 | tagged_feature_9bf85911   |

The imported **the botox course** space had 0 affected definitions. Production was not audited or changed.
