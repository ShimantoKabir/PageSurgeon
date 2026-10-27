interface TestResult {
  name: string;
  passed: boolean;
}

enum Status {
  Success = "TypeScript is working!",
}

function createBadge<T extends TestResult>(result: T): HTMLElement {
  const badge = document.createElement("div");

  badge.id = "pagesurgeon-ts-test";
  badge.textContent = `${result.passed ? "✅" : "❌"} ${result.name}`;

  Object.assign(badge.style, {
    position: "fixed",
    bottom: "20px",
    right: "20px",
    padding: "14px 20px",
    background: "#2563eb",
    color: "#fff",
    borderRadius: "10px",
    fontFamily: "sans-serif",
    zIndex: "2147483647",
  });

  return badge;
}

function runTest(): void {
  document.getElementById("pagesurgeon-ts-test")?.remove();

  const result: TestResult = {
    name: Status.Success,
    passed: true,
  };

  document.body.appendChild(createBadge(result));
  console.log("[PageSurgeon] TypeScript test passed:", result);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", runTest, { once: true });
} else {
  runTest();
}
