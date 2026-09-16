import {
  useLayoutEffect,
  useRef,
  type HTMLAttributes,
  type ReactNode,
} from "react";

type FadeTextTag = "span" | "strong" | "small" | "em" | "b";

interface FadeTextProps extends HTMLAttributes<HTMLElement> {
  as?: FadeTextTag;
  children: ReactNode;
}

/**
 * Truncates at the real container edge and only fades when the text actually
 * overflows. A permanent mask made short labels look clipped before they
 * reached the boundary, especially on narrow mobile layouts.
 */
export function FadeText({ as: Tag = "span", className = "", children, ...props }: FadeTextProps) {
  const ref = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => {
      node.classList.toggle("is-overflowing", node.scrollWidth > node.clientWidth + 1);
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [children]);

  return (
    <Tag
      {...props}
      ref={ref as never}
      className={className ? `fade-text ${className}` : "fade-text"}
    >
      {children}
    </Tag>
  );
}
