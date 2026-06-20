import { describe, test, expect } from "bun:test";
import { join } from "path";

// A utility to validate HTML tags are balanced and self-closing tags are valid
export function validateHtml(html: string): { valid: boolean; error?: string } {
    const tagRegex = /<(\/?[a-zA-Z0-9:-]+)([^>]*?)>/g;
    const stack: { tag: string; index: number }[] = [];
    let match;

    while ((match = tagRegex.exec(html)) !== null) {
        const fullTag = match[0];
        const tagName = match[1];
        const isClosing = tagName.startsWith("/");
        const actualTagName = isClosing ? tagName.slice(1) : tagName;

        // Self-closing tags in HTML5
        const isSelfClosing =
            /^(img|br|hr|input|link|meta|source|col|embed|area|param|track|wbr)$/i.test(
                actualTagName
            ) || fullTag.endsWith("/>");

        if (isSelfClosing) {
            if (isClosing) {
                return {
                    valid: false,
                    error: `Self-closing tag '${actualTagName}' cannot have a closing tag at position ${match.index}`,
                };
            }
            continue;
        }

        if (isClosing) {
            if (stack.length === 0) {
                return {
                    valid: false,
                    error: `Unexpected closing tag '${actualTagName}' at position ${match.index}`,
                };
            }
            const last = stack.pop()!;
            if (last.tag.toLowerCase() !== actualTagName.toLowerCase()) {
                return {
                    valid: false,
                    error: `Mismatched tag: expected closing tag for '${last.tag}' (opened at ${last.index}), but found '${actualTagName}' at position ${match.index}`,
                };
            }
        } else {
            stack.push({ tag: actualTagName, index: match.index });
        }
    }

    if (stack.length > 0) {
        const last = stack[stack.length - 1];
        return {
            valid: false,
            error: `Unclosed tag '${last.tag}' opened at position ${last.index}`,
        };
    }

    return { valid: true };
}

describe("Unified Email Templates Syntax Validation", () => {
    const templatesDir = join(import.meta.dir, "..", "..", "templates");

    test("email.html template should exist and be valid", async () => {
        const filePath = join(templatesDir, "email.html");
        const file = Bun.file(filePath);
        expect(await file.exists()).toBe(true);

        const content = await file.text();
        expect(content.length).toBeGreaterThan(0);

        // Ensure placeholders are present in the raw template
        expect(content).toContain("{{heading}}");
        expect(content).toContain("{{bodyText}}");
        expect(content).toContain("{{actionContent}}");
        expect(content).toContain("{{footerText}}");

        // Validate syntax on raw file
        const validation = validateHtml(content);
        if (!validation.valid) {
            throw new Error(`HTML Validation failed for email.html: ${validation.error}`);
        }
    });

    test("action-button.html template should exist and be valid", async () => {
        const filePath = join(templatesDir, "action-button.html");
        const file = Bun.file(filePath);
        expect(await file.exists()).toBe(true);

        const content = await file.text();
        expect(content.length).toBeGreaterThan(0);
        expect(content).toContain("{{url}}");
        expect(content).toContain("{{labelText}}");

        const validation = validateHtml(content);
        expect(validation.valid).toBe(true);
    });

    test("action-code.html template should exist and be valid", async () => {
        const filePath = join(templatesDir, "action-code.html");
        const file = Bun.file(filePath);
        expect(await file.exists()).toBe(true);

        const content = await file.text();
        expect(content.length).toBeGreaterThan(0);
        expect(content).toContain("{{code}}");
        expect(content).toContain("{{color}}");

        const validation = validateHtml(content);
        expect(validation.valid).toBe(true);
    });

    test("rendered output with sub-templates should be valid HTML", async () => {
        const emailPath = join(templatesDir, "email.html");
        const buttonPath = join(templatesDir, "action-button.html");
        const codePath = join(templatesDir, "action-code.html");

        const emailContent = await Bun.file(emailPath).text();
        let buttonContent = await Bun.file(buttonPath).text();
        let codeContent = await Bun.file(codePath).text();

        // Render button sub-template
        buttonContent = buttonContent
            .replaceAll("{{url}}", "https://example.com")
            .replaceAll("{{labelText}}", "Click Me");

        // Render code sub-template
        codeContent = codeContent
            .replaceAll("{{code}}", "123456")
            .replaceAll("{{color}}", "#38bdf8");

        // Render layout template with button action content
        const renderedWithButton = emailContent
            .replaceAll("{{heading}}", "Heading")
            .replaceAll("{{bodyText}}", "Text")
            .replaceAll("{{actionContent}}", buttonContent)
            .replaceAll("{{footerText}}", "Footer");

        expect(validateHtml(renderedWithButton).valid).toBe(true);

        // Render layout template with code action content
        const renderedWithCode = emailContent
            .replaceAll("{{heading}}", "Heading")
            .replaceAll("{{bodyText}}", "Text")
            .replaceAll("{{actionContent}}", codeContent)
            .replaceAll("{{footerText}}", "Footer");

        expect(validateHtml(renderedWithCode).valid).toBe(true);
    });

    test("validateHtml helper should catch unbalanced tags", () => {
        expect(validateHtml("<div><p>Hello</div></p>").valid).toBe(false);
        expect(validateHtml("<div><p>Hello</p>").valid).toBe(false);
        expect(validateHtml("<div>Hello</div>").valid).toBe(true);
        expect(validateHtml("<div><br>Hello</div>").valid).toBe(true);
    });
});
