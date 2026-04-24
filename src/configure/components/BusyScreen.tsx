import React from "react";
import { Box, Text } from "ink";
import { Spinner } from "./Spinner.js";

type BusyScreenProps = {
  message: string;
  qrText?: string | null;
};

export function BusyScreen({
  message,
  qrText,
}: BusyScreenProps): React.JSX.Element {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>Working</Text>
      <Box marginTop={1}>
        <Spinner type="dots" color="cyan" />
        <Text>{` ${message}`}</Text>
      </Box>
      {qrText?.trim() ? (
        <Box marginTop={1} flexDirection="column">
          <Text color="yellow">Scan this QR with WhatsApp:</Text>
          <Text>{qrText}</Text>
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text color="gray">Please wait...</Text>
      </Box>
    </Box>
  );
}
