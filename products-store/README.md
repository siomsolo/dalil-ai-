# Digital Products Store (MVP)
Private-owned digital products catalog on Cloudflare Pages.

## Included
- Searchable product catalog with category/language/market filters.
- Admin form for product metadata and direct PDF/ZIP/EPUB upload.
- Cover image upload with preview.
- D1 product metadata and R2 private file storage.
- Product detail routes with SEO metadata and Product structured data.
- Public catalog reads only published products.

## Cloudflare setup required
1. Enable R2 in the Cloudflare dashboard (R2 API currently reports it is not enabled on this account).
2. Bind D1 database `digital-products-store` as `DB`.
3. Bind R2 bucket `digital-products-files` as `FILES`.
4. Set Pages secret `ADMIN_PASSWORD` to a strong password.
5. Apply `schema.sql` to D1.
6. Configure LomoPay webhook and secure checkout before enabling purchases. Checkout is intentionally not represented as live yet.

## File handling
Product files are stored in R2 under opaque product keys. They are not publicly served by the media route; only cover images are served. Secure purchase/download endpoints must be added alongside the confirmed payment webhook before selling files.

## Current MVP limits
- Admin upload max: 40 MB per product file; cover max: 5 MB.
- This first version requires the admin password secret and Cloudflare bindings.
- Product copy is entered in the form in this scaffold; next iteration can add an AI enrichment endpoint to draft SEO metadata from an uploaded file after the AI provider key is configured.
