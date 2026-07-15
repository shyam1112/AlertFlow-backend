# Candela — Salesforce to Shopify Product Sync: Integration Reference

**Version:** 1.1
**Date:** March 2026
**Last Updated:** Fixed $0-price catalog handling, image upload behaviour, PPC flag hyphen variants
**Integration:** Salesforce (Sandbox) → MuleSoft → Shopify (Sandbox) (sandbox =  salesforce testing platform)

---

## 1. Overview

This document describes how the **automatic product synchronization** works between Salesforce and Shopify.
automatic product synchronization
Whenever a product is **created**, **updated**, or **deleted** in Salesforce, the system automatically reflects that change in Shopify — without any manual action.

```
Product change saved in Salesforce
           ↓
System detects the change automatically (within seconds)
           ↓
Fetches full product details from Salesforce
           ↓
Creates / Updates / Deletes the product in Shopify
```

---

## 2. Environments

| System | URL |
|--------|-----|
| **Salesforce Sandbox** |

url : test.salesforce.com

Dev - username : salesforce@mlveda.com.shopifydev (you can create/update product)
      password : Himalaya@84 
      
fulpartial - username : salesforce@mlveda.com.fulpartial
             password : N^0R7uFN$fgecR

| **Shopify Sandbox** | https://candela-sandbox.myshopify.com/admin |

---

## 3. Which Products Get Synced

Not every product in Salesforce syncs to Shopify. A product is synced **only when ALL of the following are true:**

| Condition | Salesforce Field | Required Value |
|-----------|------------------|----------------|
| Product must be active | `IsActive` | True |
| PPC Flag must be set | `PPC_Flag__c` | `PPC`, `PPC - Non Inventory` (hyphen), or `PPC – Non Inventory` (em-dash) |
| Visible in eStore | `View_in_eStore__c` | True |

If any of these three conditions is not met, the product is **skipped** — it will not appear in or be removed from Shopify.

> **Note on PPC Flag:** The system accepts both a regular hyphen (`-`) and an em-dash (`–`) for the "Non Inventory" variant. Either value in Salesforce will be matched correctly.

---

## 4. Field Mapping — Salesforce to Shopify

| Shopify Field | Salesforce Field | Fallback / Notes |
|---------------|------------------|------------------|
| **Title** | `Web_Name__c` | Falls back to `Name` if Web Name is blank |
| **Description** | `Description` | Falls back to `SHOP_Description__c` if blank |
| **SKU** | `ProductCode` | Used as the unique identifier to match products |
| **Status** | `View_in_eStore__c` | True → Active, False → Draft |
| **Vendor** | `Product_Company__c` | Falls back to `"Candela"` if blank |
| **Product Type** | `Part_Type__c` | Falls back to `Family` if blank |
| **Tags** | `SHOP_Meta_Tags__c` | Comma-separated values |
| **Variant Price** | Pricebook (USD) | See Section 5 — Pricing Logic |
| **Weight** | `Weight__c` + `Weight_UM__c` | Converted to Shopify weight units |
| **Image** | — | **Not synced.** Image upload is skipped. Images must be added manually in Shopify. |

### Metafields Stored on the Shopify Product

Additional Salesforce data is stored in Shopify as **metafields** under the `salesforce` namespace:

| Metafield Key | Salesforce Field | Type |
|---------------|-----------------|------|
| `salesforce.id` | `Id` | Text |
| `salesforce.model` | `SVMX_Model_Text__c` | Text |
| `salesforce.model_product_line` | `Model_Product_Line__c` | Text |
| `salesforce.qty_widget_type` | `Qty_Weidget_Type__c` | Text |
| `salesforce.dimension_um` | `Dimension_UM__c` | Text |
| `salesforce.dim_length` | `Dim_Length__c` | Decimal number |
| `salesforce.dim_width` | `Dim_Width__c` | Decimal number |
| `salesforce.dim_height` | `Dim_Height__c` | Decimal number |
| `salesforce.lot_size` | `Lot_size__c` | Integer |
| `salesforce.user_manual_files_root` | `Files_Root__c` | Text |
| `salesforce.special_offer` | `Special_offer__c` | Multi-line text |
| `salesforce.steps_for_widget` | `Steps_for_widget__c` | Multi-line text |

---

## 5. Pricing Logic

Pricing is the most important part of the sync. The system handles **two levels of pricing** from Salesforce:

1. **Standard / Public Price** — the base price shown on the Shopify product variant
2. **B2B Catalog Prices** — per-currency, per-pricebook prices stored in Shopify Catalogs with Price Lists

---

### 5.1 Standard Price (Shopify Variant Price)

The standard price is the **public-facing price** on the Shopify product page variant.

**How it is determined from Salesforce Pricebook Entries:**

```
Step 1: Look at all active Pricebook Entries for the product (IsActive = true)
         ↓
         Note: $0.00 (zero) prices are VALID and ARE included.
               A $0 price means the product is free (e.g. marketing materials,
               white papers, non-inventory items). These are still synced.
         ↓
Step 2: Prefer the "Online-Store US" USD entry → set as the Shopify variant price
         ↓
         No "Online-Store US" entry? → use any active USD pricebook price
         ↓
         No USD entry? → use the first available active pricebook price
         ↓
         No active pricebook entries at all? → price is set to $0.00
```

> **Important for testers:** A product with all $0.00 pricebook entries is **not an error**. The product is still created in Shopify and assigned to its catalogs. This is by design for non-inventory and marketing material products (`PPC – Non Inventory`).

**Where to see it in Shopify:**
- Product page → Variants section → **Price** field under "Default Title"

---

### 5.2 B2B Catalog Prices (Per-Currency, Per-Pricebook Pricing)

The system processes pricebook entries for **four target currencies: USD, GBP, CAD, AUD**.

Each qualifying Salesforce pricebook entry gets its own **Shopify Catalog with a Price List**, allowing different customer groups to see different prices.

> **Qualifying means: `IsActive = true`.** A $0.00 price entry is still qualifying — the catalog is created and the product is added to the catalog's **Included Products** list with a $0 price. A pricebook entry is only excluded if `IsActive = false`.

---

#### 5.2.1 Currency Rules

The system applies **different rules** depending on the currency:

| Currency | Country | Rule |
|----------|---------|------|
| **USD** | United States | All active pricebook entries with USD are processed. Each pricebook gets its own catalog. |
| **GBP** | United Kingdom | All active pricebook entries with GBP are processed. Each pricebook gets its own catalog. |
| **CAD** | Canada | All active pricebook entries with CAD are processed. Each pricebook gets its own catalog. |
| **AUD** | Australia | **Special rule — only the "Standard Price" pricebook entry with AUD is used.** All other pricebooks with AUD are ignored. |

> **Why is AUD special?** Australia pricing in Salesforce is maintained only in the Standard Price pricebook. Other pricebooks do not carry AUD entries with valid prices, so the system is configured to only pick up the Standard Price AUD entry to avoid duplicates or incorrect prices.


---

#### 5.2.2 How Catalog Names Are Generated

The Shopify catalog title is automatically built from the Salesforce pricebook name and currency code:

```
Catalog Title = "{Salesforce Pricebook Name} - {Currency Code}"
```

Examples:
```
  "Online-Store US - USD"
  "US Distributor - USD"
  "UK Dealer - GBP"
  "Canada Pricebook - CAD"
  "Standard Price - AUD"    ← AUD always uses Standard Price pricebook name
```

This naming convention is how the system **matches** Salesforce pricebook entries to existing Shopify catalogs. If the name matches exactly, it updates the price. If no catalog exists yet, it creates one.

---

#### 5.2.3 Full Catalog Sync Flow

For each qualifying pricebook entry (IsActive = true, any price including $0), the system automatically:

```
Step 1: Check if a Shopify catalog exists with title "{PricebookName} - {Currency}"
         ↓
Step 2: Catalog not found?
        → Create a new B2B Catalog with that title
        → Create a Price List linked to this catalog (same currency)
         ↓
Step 3: Catalog exists but has no Price List?
        → Create a Price List and link it to the catalog
         ↓
Step 4: Set the price in the Price List (even if price is $0.00)
         ↓
Step 5: Add the product to the catalog's Included Products list
        (the product appears under the catalog's "Products → Included" tab in Shopify)
```

> **Included vs Excluded:** When a product is assigned to a catalog, it is placed in the **Included Products** list (manual product selection). It will NOT appear under Excluded. If a product is missing from a catalog, check the "Included" tab — not the main products list.

#### Where to See Catalog Prices in Shopify

1. Go to Shopify Admin → **Catalogs** (B2B section)
2. Each catalog corresponds to one Salesforce pricebook + currency combination
3. Open a catalog → **Products** tab → find the product
4. The price shown is the price from that specific Salesforce pricebook

---

### 5.3 Pricing Summary Table

| Price Type | Currency | Salesforce Source | Rule | Where in Shopify |
|------------|----------|-------------------|------|-----------------|
| **Variant Price** (public) | USD preferred | Any **active** pricebook (USD first) | "Online-Store US" USD → any USD → first active | Product → Default Title → Price |
| **USD Catalog** | USD | Any **active** pricebook with USD (including $0) | All active USD pricebooks processed | Catalog: `"{PricebookName} - USD"` |
| **GBP Catalog** | GBP | Any **active** pricebook with GBP (including $0) | All active GBP pricebooks processed | Catalog: `"{PricebookName} - GBP"` |
| **CAD Catalog** | CAD | Any **active** pricebook with CAD (including $0) | All active CAD pricebooks processed | Catalog: `"{PricebookName} - CAD"` |
| **AUD Catalog** | AUD | Standard Price pricebook only (including $0) | Only Standard Price pricebook | Catalog: `"Standard Price - AUD"` |

> **Active** means `IsActive = true` on the Pricebook Entry in Salesforce. A $0.00 price with `IsActive = true` **is included**. A non-zero price with `IsActive = false` **is excluded**.

---

### 5.4 Example A: A Product with Multiple Pricebooks (Regular Prices)

Suppose a product in Salesforce has the following active Pricebook Entries:

| Pricebook Name | Currency | Unit Price | IsActive |
|----------------|----------|------------|----------|
| Standard Price Book | USD | $100.00 | ✓ |
| Online-Store US | USD | $95.00 | ✓ |
| UK Dealer | GBP | £80.00 | ✓ |
| Canada Pricebook | CAD | CA$130.00 | ✓ |
| Standard Price Book | AUD | AU$150.00 | ✓ |
| Australia Distributor | AUD | AU$120.00 | ✓ |
| Old Pricebook | USD | $200.00 | ✗ (inactive) |

After sync, Shopify will have:

| Location in Shopify | Value | Notes |
|---------------------|-------|-------|
| Product variant price (public) | **$95.00 USD** | "Online-Store US" preferred; falls back to any USD |
| Catalog: `"Standard Price Book - USD"` | **$100.00** | USD — all active pricebooks |
| Catalog: `"Online-Store US - USD"` | **$95.00** | USD — all active pricebooks |
| Catalog: `"UK Dealer - GBP"` | **£80.00** | GBP — all active pricebooks |
| Catalog: `"Canada Pricebook - CAD"` | **CA$130.00** | CAD — all active pricebooks |
| Catalog: `"Standard Price Book - AUD"` | **AU$150.00** | AUD — Standard Price only |
| ~~Australia Distributor - AUD~~ | ~~AU$120.00~~ | **Skipped** — AUD only uses Standard Price pricebook |
| ~~Old Pricebook - USD~~ | ~~$200.00~~ | **Skipped** — IsActive = false |

---

### 5.4 Example B: A Non-Inventory / Marketing Material Product (All $0 Prices)

Suppose a product with `PPC_Flag__c = "PPC – Non Inventory"` has these entries:

| Pricebook Name | Currency | Unit Price | IsActive |
|----------------|----------|------------|----------|
| B2B Standard Price Book | USD | $0.00 | ✓ |
| B2B Standard Price Book | CAD | CA$0.00 | ✓ |
| Online-Store CA | CAD | CA$0.00 | ✓ |
| Online-Store US | USD | $0.00 | ✓ |

After sync, Shopify will have:

| Location in Shopify | Value | Notes |
|---------------------|-------|-------|
| Product variant price (public) | **$0.00 USD** | "Online-Store US" picked (active, $0 is valid) |
| Catalog: `"B2B Standard Price Book - USD"` | **$0.00** | Product in Included list |
| Catalog: `"B2B Standard Price Book - CAD"` | **CA$0.00** | Product in Included list |
| Catalog: `"Online-Store CA - CAD"` | **CA$0.00** | Product in Included list |
| Catalog: `"Online-Store US - USD"` | **$0.00** | Product in Included list |

> This is **correct and expected behaviour**. Do not raise a defect for $0 catalog prices on non-inventory products.

---

## 6. Product Delete Logic

When a product is deactivated or removed in Salesforce, it is deleted from Shopify.

**A product is deleted from Shopify when:**
- `PPC_Flag__c` is changed to a non-PPC value, OR
- `View_in_eStore__c` is set to False, OR
- `IsActive` is set to False

The system finds the product in Shopify by its SKU (`ProductCode`) and removes it entirely.

> **Note:** The delete is permanent in Shopify. If the product is re-activated in Salesforce, it will be re-created as a brand new product.

---

## 7. Sync Timing

| Event in Salesforce | Expected time to appear in Shopify |
|---------------------|-----------------------------------|
| Product created | 5 – 30 seconds |
| Product updated | 5 – 30 seconds |
| Product deleted / deactivated | 5 – 30 seconds |

The integration runs as a persistent real-time listener (Salesforce Change Data Capture). There is no scheduled batch — changes are picked up immediately.

---

## 8. Known Constraints & Validation Rules

This section documents intentional behaviours that are **not defects**. Do not raise issues for these.

| # | Behaviour | Reason |
|---|-----------|--------|
| 1 | Product with all **$0.00 pricebook entries** is still created in Shopify and assigned to catalogs | $0 is a valid price for non-inventory/marketing material products (`PPC – Non Inventory`) |
| 2 | **Image is not synced** — Shopify product has no image after sync | Image upload is intentionally disabled. Images must be added manually in Shopify. |
| 3 | Salesforce image URLs (`*.salesforce.com`, `*.force.com`) are **not used** as Shopify product images | These are authenticated Salesforce endpoints — Shopify cannot fetch them externally |
| 4 | PPC Flag `PPC - Non Inventory` (regular hyphen `-`) and `PPC – Non Inventory` (em-dash `–`) are both accepted | Salesforce allows either character; both are treated identically |
| 5 | A pricebook entry with `IsActive = false` is **never synced** regardless of price | Inactive entries are intentionally excluded |
| 6 | AUD pricing only uses the **Standard Price pricebook** | All other AUD pricebooks in Salesforce are ignored by design |
| 7 | Catalogs are created using **manual product selection** | The product appears under the catalog's **Included Products** tab, not in a blanket "all products" list |
| 8 | Products not meeting the sync conditions (Section 3) return **0 results from Salesforce** — this is not an API error | The SOQL query filters at source; if a product doesn't match, it is intentionally excluded |

---

## 9. Important Notes

> The sync only works when the MuleSoft integration service is running. If no changes appear in Shopify after 2 minutes, the integration service may need to be restarted — contact the development team.

> Always use **sandbox environments** for testing. Never make test changes in the production Salesforce or Shopify.

> Do not manually create or edit products directly in Shopify. All product data must flow from Salesforce to ensure the two systems stay in sync.

> **Images are not synced automatically.** After a product is created in Shopify via the sync, images must be uploaded manually in the Shopify Admin.

---

