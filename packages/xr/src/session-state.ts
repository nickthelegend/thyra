/** What the 2D page hands to the headset session: an uploaded image and typed words. */
export const sessionInput: {
  upload: { url: string; name: string } | null;
  typed: string;
} = { upload: null, typed: '' };
