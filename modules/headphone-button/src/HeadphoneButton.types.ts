export type ButtonEventType = "single" | "double";

export type ButtonEventPayload = {
  type: ButtonEventType;
};

export type HeadphoneButtonModuleEvents = {
  onButtonEvent: (params: ButtonEventPayload) => void;
};
