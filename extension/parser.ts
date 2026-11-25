/** Self-contained so scripting.executeScript can inject it without module dependencies. */
export function readVisiblePage() {
  const webUrl = (value: string | null): string | null => {
    if (!value) return null;
    try {
      const url = new URL(value, location.href);
      return ["https:", "http:"].includes(url.protocol) ? url.href : null;
    } catch {
      return null;
    }
  };
  const visible = (element: Element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < innerHeight &&
      rect.left < innerWidth &&
      style.visibility !== "hidden" &&
      style.display !== "none" &&
      style.opacity !== "0"
    );
  };
  const textOf = (element: Element, limit: number) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const text: string[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (
        !parent ||
        parent.closest(
          'script,style,noscript,input,textarea,[contenteditable="true"],[aria-hidden="true"]',
        ) ||
        !visible(parent)
      )
        continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      if (
        ![...range.getClientRects()].some(
          (r) => r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth,
        )
      )
        continue;
      const value = node.textContent?.trim();
      if (value) text.push(value);
    }
    return text.join("\n").slice(0, limit);
  };
  const images = (element: Element) =>
    [
      ...new Set(
        [...element.querySelectorAll("img")]
          .filter(visible)
          .map((img) => webUrl(img.currentSrc || img.getAttribute("src")))
          .filter((url): url is string => url !== null),
      ),
    ].slice(0, 30);
  const isGroup =
    /(^|\.)facebook\.com$/i.test(location.hostname) && /^\/groups\/[^/]+/.test(location.pathname);
  const groupName =
    document.querySelector("h1")?.textContent?.trim().slice(0, 300) ?? document.title.slice(0, 300);
  const posts: import("./capture.js").PostCapture[] = [];
  if (isGroup) {
    for (const article of [...document.querySelectorAll('[role="article"]')].filter(visible)) {
      if (article.parentElement?.closest('[role="article"]')) continue;
      const links = [...article.querySelectorAll<HTMLAnchorElement>("a[href]")];
      const postLink = links
        .map((a) => webUrl(a.href))
        .find(
          (value) => value && /\/groups\/[^/]+\/(posts|permalink)\/|\/permalink\.php/.test(value),
        );
      if (!postLink || posts.some((post) => post.postUrl === postLink)) continue;
      const text = textOf(article, 20000);
      if (!text) continue;
      const author = article.querySelector<HTMLAnchorElement>(
        "h2 a[href], h3 a[href], strong a[href]",
      );
      posts.push({
        postUrl: postLink,
        groupName,
        posterName: author?.textContent?.trim().slice(0, 300) || null,
        posterProfileUrl: webUrl(author?.href ?? null),
        text,
        photoUrls: images(article),
      });
      if (posts.length === 50) break;
    }
  }
  return {
    isGroup,
    groupName,
    posts,
    page: {
      url: location.href,
      title: document.title.slice(0, 500),
      text: textOf(document.body, 30000),
      photoUrls: images(document.body),
    },
  };
}
