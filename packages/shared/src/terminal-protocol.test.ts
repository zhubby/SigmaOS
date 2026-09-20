import { describe, expect, it } from "vitest";
import {
  encodeTerminalBrokerMessage,
  parseTerminalBrokerEvent,
  parseTerminalBrokerMessage
} from "./terminal-protocol.js";

describe("terminal broker protocol", () => {
  it("parses bounded open, input, resize, and close requests", () => {
    expect(parseTerminalBrokerMessage('{"type":"open","user":"zhubby","cols":120,"rows":32}')).toEqual({
      type: "open",
      user: "zhubby",
      cols: 120,
      rows: 32
    });
    expect(parseTerminalBrokerMessage('{"type":"input","data":"pwd\\r"}')).toEqual({
      type: "input",
      data: "pwd\r"
    });
    expect(parseTerminalBrokerMessage('{"type":"resize","cols":90,"rows":24}')).toEqual({
      type: "resize",
      cols: 90,
      rows: 24
    });
    expect(parseTerminalBrokerMessage('{"type":"close"}')).toEqual({ type: "close" });
    expect(parseTerminalBrokerMessage('{"type":"close","destroy":true}')).toEqual({ type: "close", destroy: true });
    expect(parseTerminalBrokerMessage('{"type":"open","user":"zhubby","cols":120,"rows":32,"sessionName":"sigmaos-demo"}')).toEqual({
      type: "open",
      user: "zhubby",
      cols: 120,
      rows: 32,
      sessionName: "sigmaos-demo"
    });
    expect(parseTerminalBrokerMessage('{"type":"open","user":"zhubby","cols":120,"rows":32,"sessionName":"sigmaos-demo","persistent":true}')).toEqual({
      type: "open",
      user: "zhubby",
      cols: 120,
      rows: 32,
      sessionName: "sigmaos-demo",
      persistent: true
    });
    expect(parseTerminalBrokerMessage('{"type":"destroy","user":"zhubby","sessionName":"sigmaos-demo"}')).toEqual({
      type: "destroy",
      user: "zhubby",
      sessionName: "sigmaos-demo"
    });
  });

  it("rejects malformed and out-of-range requests", () => {
    expect(parseTerminalBrokerMessage("not json")).toBeNull();
    expect(parseTerminalBrokerMessage('{"type":"open","user":"root","cols":1,"rows":32}')).toBeNull();
    expect(parseTerminalBrokerMessage('{"type":"input","data":null}')).toBeNull();
    expect(parseTerminalBrokerMessage('{"type":"resize","cols":120,"rows":201}')).toBeNull();
    expect(parseTerminalBrokerMessage('{"type":"open","user":"zhubby","cols":120,"rows":32,"sessionName":"bad name"}')).toEqual({
      type: "open",
      user: "zhubby",
      cols: 120,
      rows: 32
    });
    expect(parseTerminalBrokerMessage('{"type":"destroy","user":"zhubby","sessionName":"bad name"}')).toBeNull();
  });

  it("parses broker events and encodes newline-delimited messages", () => {
    const event = { type: "ready", user: "zhubby", cwd: "/home/zhubby", shell: "/usr/bin/zsh" } as const;
    expect(parseTerminalBrokerEvent(JSON.stringify(event))).toEqual(event);
    expect(parseTerminalBrokerEvent('{"type":"exit","exitCode":0}')).toEqual({ type: "exit", exitCode: 0 });
    expect(parseTerminalBrokerEvent('{"type":"destroyed","sessionName":"sigmaos-demo"}')).toEqual({
      type: "destroyed",
      sessionName: "sigmaos-demo"
    });
    expect(encodeTerminalBrokerMessage(event)).toBe(`${JSON.stringify(event)}\n`);
  });
});
