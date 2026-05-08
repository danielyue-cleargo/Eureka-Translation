import assert from "node:assert/strict";
import test from "node:test";
import { productTextFromHtml } from "./source";

test("extracts product terminology lines from ecommerce html", () => {
  const text = productTextFromHtml(`
    <html>
      <head>
        <title>Eureka J15 Max Ultra Roboterstaubsauger</title>
        <meta name="description" content="Saugkraft von 22000 Pa" />
      </head>
      <body>
        <nav>Account Cart Privacy</nav>
        <h1>Eureka J15 Max Ultra Roboterstaubsauger</h1>
        <h2>Duale Entwirrtechnologie</h2>
        <li>Staubbeutel x 3</li>
        <td>Überquerung von 45 mm Schwellen</td>
        <button>Add to cart</button>
      </body>
    </html>
  `);

  assert.match(text, /Eureka J15 Max Ultra Roboterstaubsauger/);
  assert.match(text, /Duale Entwirrtechnologie/);
  assert.match(text, /Staubbeutel x 3/);
  assert.match(text, /Überquerung von 45 mm Schwellen/);
  assert.doesNotMatch(text, /Add to cart/);
});
