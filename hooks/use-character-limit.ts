"use client";

import { useCallback, useState } from "react";

export function useCharacterLimit({
  initialValue = "",
  maxLength,
}: {
  initialValue: string;
  maxLength: number;
}) {
  const [value, setValue] = useState(initialValue.slice(0, maxLength));
  const characterCount = value.length;

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
      setValue(e.target.value.slice(0, maxLength));
    },
    [maxLength]
  );

  return {
    value,
    characterCount,
    handleChange,
    maxLength,
  };
}
