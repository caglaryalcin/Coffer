# Third-party notices

## selfh.st/icons

The `public/brands/selfhst-*.svg` files are sourced from the
[selfh.st/icons](https://github.com/selfhst/icons) collection at commit
`948e3aa28d3110ee23957473a85431650e10e778`.

The collection is distributed under the
[Creative Commons Attribution 4.0 International license](https://creativecommons.org/licenses/by/4.0/).
The complete upstream license text and attribution notice are included as
`public/brands/selfhst-LICENSE.txt` and `public/brands/selfhst-ATTRIBUTION.txt`.

Coffer makes the following modifications during import:

- Every upstream filename receives a `selfhst-` prefix so the assets can be
  integrated into Coffer's existing brand catalog without collisions.
- `selfhst-paypal-light.svg`: removes one empty, self-closing Adobe Illustrator
  `foreignObject` element to satisfy Coffer's passive-SVG policy. The visible
  artwork is unchanged.

All other SVG files are copied byte-for-byte from the pinned upstream commit.
Names and logos remain the property or trademarks of their respective owners.
Their inclusion does not imply affiliation with or endorsement of Coffer.
