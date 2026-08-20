import { describe, expect, it } from "vitest";

import { isPersistedDesignDocument } from "./use-design-image-generation";

describe("Design image generation persistence boundary", () => {
    it("accepts a replay only when the visible document revision is confirmed by the server", () => {
        expect(isPersistedDesignDocument("saved", 8, 8)).toBe(true);
        expect(isPersistedDesignDocument("saved", 7, 8)).toBe(false);
        expect(isPersistedDesignDocument("dirty", 7, 8)).toBe(false);
        expect(isPersistedDesignDocument("saving", 7, 8)).toBe(false);
        expect(isPersistedDesignDocument("error", 7, 8)).toBe(false);
        expect(isPersistedDesignDocument("conflict", 7, 8)).toBe(false);
    });
});
