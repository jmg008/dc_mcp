import { AsyncLocalStorage } from "node:async_hooks";
import { TARGET_GALLERY_ID } from "../types/dc.js";

export interface RequestContext {
  requestId?: string;
  galleryId?: string;
  postNo?: string | null;
}

const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext {
  return requestContextStorage.getStore() ?? {
    galleryId: TARGET_GALLERY_ID,
    postNo: null,
  };
}

export async function runWithRequestContext<T>(
  context: RequestContext,
  work: () => Promise<T>,
): Promise<T> {
  const mergedContext: RequestContext = {
    ...getRequestContext(),
    ...context,
  };

  return requestContextStorage.run(mergedContext, work);
}
