import {
  COMPOSER_CHROME_BOX_CLASS,
  COMPOSER_CHROME_SHADOW_CLASS,
  COMPOSER_CHROME_SURFACE_CLASS,
} from "./composer-chrome"

describe("composer chrome", () => {
  it("is always-on selected chrome, not a click-only focus ring", () => {
    expect(COMPOSER_CHROME_BOX_CLASS).toContain("codeg-composer-chrome")
    expect(COMPOSER_CHROME_BOX_CLASS).toContain("rounded-2xl")
    expect(COMPOSER_CHROME_BOX_CLASS).toContain("border-foreground/15")
    expect(COMPOSER_CHROME_BOX_CLASS).not.toContain("focus-within")
    expect(COMPOSER_CHROME_SHADOW_CLASS).toContain("shadow-[")
    expect(COMPOSER_CHROME_SURFACE_CLASS).toContain("ws-transparent-bg")
  })
})
