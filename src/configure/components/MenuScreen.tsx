import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { MenuItem } from "../types.js";
import { SelectMenuItem } from "./SelectMenuItem.js";

type MenuScreenProps = {
  title?: string;
  description?: string;
  items: MenuItem[];
  footerHint?: string;
  searchable?: boolean;
  pageSize?: number | undefined;
};

export function MenuScreen({
  title,
  description,
  items,
  footerHint = "enter: select | esc: back | ctrl+c: exit",
  searchable = false,
  pageSize,
}: MenuScreenProps): React.JSX.Element {
  const hasHeader = Boolean(title?.trim()) || Boolean(description?.trim());
  const keyedItems = items.map((item, index) => ({
    ...item,
    key: item.key ?? `${title ?? "menu"}:${index}:${item.label}`,
  }));
  const utilityItems = keyedItems.filter(isUtilityItem);
  const primaryItems = keyedItems.filter((item) => !isUtilityItem(item));
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);

  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!searchable || !normalized) {
      return primaryItems;
    }
    return primaryItems.filter((item) =>
      item.label.toLowerCase().includes(normalized),
    );
  }, [primaryItems, query, searchable]);

  const navigableItems = useMemo(
    () => [...filteredItems, ...utilityItems],
    [filteredItems, utilityItems],
  );

  useEffect(() => {
    setCursor((current) => {
      if (navigableItems.length === 0) {
        return 0;
      }
      return Math.min(current, navigableItems.length - 1);
    });
  }, [navigableItems.length]);

  useInput((input, key) => {
    if (key.upArrow || input === "k") {
      setCursor((current) =>
        navigableItems.length === 0
          ? 0
          : (current - 1 + navigableItems.length) % navigableItems.length,
      );
      return;
    }
    if (key.downArrow || input === "j") {
      setCursor((current) =>
        navigableItems.length === 0 ? 0 : (current + 1) % navigableItems.length,
      );
      return;
    }
    if (key.return) {
      const selected = navigableItems[cursor];
      if (!selected) {
        return;
      }
      void selected.value();
      return;
    }
    if (!searchable) {
      return;
    }
    if (key.backspace || key.delete) {
      setQuery((current) => current.slice(0, -1));
      return;
    }
    if (!key.ctrl && !key.meta && input.length === 1 && input >= " ") {
      setQuery((current) => current + input);
    }
  });

  const effectivePageSize = Math.max(
    1,
    pageSize ?? (filteredItems.length || 1),
  );
  const start = Math.max(
    0,
    Math.min(
      cursor - Math.floor(effectivePageSize / 2),
      Math.max(0, filteredItems.length - effectivePageSize),
    ),
  );
  const visibleItems = filteredItems.slice(start, start + effectivePageSize);
  const totalVisibleItems = [...visibleItems, ...utilityItems];

  return (
    <Box flexDirection="column" marginTop={1}>
      {title?.trim() ? <Text bold>{title}</Text> : null}
      {description ? <Text color="gray">{description}</Text> : null}
      {searchable ? (
        <Box marginTop={1}>
          <Text color="gray">
            <Text bold>search:</Text> {query || "(type to filter)"}
          </Text>
        </Box>
      ) : null}
      <Box marginTop={hasHeader ? 1 : 0}>
        <Box flexDirection="column">
          {totalVisibleItems.length > 0 ? (
            totalVisibleItems.map((item, index) => {
              const absoluteIndex =
                index < visibleItems.length
                  ? start + index
                  : filteredItems.length + (index - visibleItems.length);
              return (
                <Box key={item.key}>
                  <Text color={absoluteIndex === cursor ? "blue" : "gray"}>
                    {absoluteIndex === cursor ? "> " : "  "}
                  </Text>
                  <SelectMenuItem
                    isSelected={absoluteIndex === cursor}
                    label={item.label}
                    boldSubstring={item.boldSubstring}
                  />
                </Box>
              );
            })
          ) : (
            <Text color="gray">No matches.</Text>
          )}
        </Box>
      </Box>
      {filteredItems.length > 0 ? (
        <Box marginTop={1}>
          <Text color="gray">
            showing {start + 1}-
            {Math.min(start + visibleItems.length, filteredItems.length)} of{" "}
            {filteredItems.length}
          </Text>
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text color="gray">{footerHint}</Text>
      </Box>
    </Box>
  );
}

function isUtilityItem(item: { key?: string; label: string }): boolean {
  return item.key?.endsWith(":back") === true || item.label.trim() === "Back";
}
