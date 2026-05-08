# Translation Generation Rules

## Primary Source Language

For Product website URL input, detect the language of the primary source page from its text, URL, and page context.

- If the primary source language is English, keep the default behavior: `canonical` uses the English source wording.
- If the primary source language is not English, `canonical` must be an AI-generated English translation of the source term.
- Do not copy non-English primary wording into `canonical`.
- If the detected primary source language is DE, FR, IT, or ES, keep the exact original source wording in the matching `translations.<locale>` field.
- Generate or match the other locale translations as usual.

## Multilingual Source References

When localized sources are provided, they are reference copy for specific languages:

- `DE` source should be German.
- `FR` source should be French.
- `IT` source should be Italian.
- `ES` source should be Spanish.

Use exact localized source wording for confident apple-to-apple matches. Website localized wording wins over newly generated translation.

## Extract Only Product-Relevant Reusable Translation Items

Extract reusable product content, not every text fragment on the page.

### Product Name

Extract the full model or product name.

Example:

- `Eureka J15 Max Ultra Roboterstaubsauger`

### Key Product Claims And Features

Extract short product feature phrases, hero bullets, capability claims, named technologies, and important selling points.

Examples:

- `Sowohl Wischmopp als auch Seitenbürste verlängern sich`
- `Saugkraft von 22000 Pa`
- `Duale Entwirrtechnologie`
- `Duales Sichtsystem`
- `Duale Selbstreinigungsbasisstation`
- `Überquerung von 45 mm Schwellen`
- `Verdopple für eine tiefere Reinigung`
- `Dualer Erweiterung für die vollständige Hausreinigung`
- `Abdeckungsrate - 100/100, mit Auszeichnung`

### Accessories And Package Contents

Extract included items and quantities.

Examples:

- `J15 Pro Ultra Roboterstaubsauger x 1`
- `Staubbeutel x 3`
- `Walzenbürste`
- `Basisrampe`
- `Wischmopp-Halter x 2`
- `Mopp x 2`
- `Reinigungsbürste`
- `Seitenbürste`
- `Bedienungsanleitung`

### Specification Titles

Extract section headings for specs.

Examples:

- `Abmessungen des Saugroboters`
- `Abmessungen der Basisstation`
- `Akkukapazität`

### Specifications

Extract measurable values, durations, dimensions, thresholds, noise values, and units.

Examples:

- `13.94 x 13.98 x 4.33 inches`
- `Bis zu 360 Minuten`
- `62 dB(A)* (im reinen Wischmodus)`

## Classification Guidance

- Product name -> `product_name`
- Hero bullets and product capabilities -> `feature`
- Named proprietary technologies -> `feature_naming`
- Package contents -> `accessory`
- Spec section headings -> `specification_title`
- Measurable values, dimensions, durations, noise, and thresholds -> `specification`
- Do not output `description`. Categorize reusable product wording by meaning instead.

## Exclude

Do not extract navigation, cookie text, reviews, prices, shipping, checkout, long paragraphs, duplicate variants, or generic marketing filler.
