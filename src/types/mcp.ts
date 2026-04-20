export interface SearchDocument {
  id: string;
  title: string;
  url: string;
  postNo: string;
  author: string | null;
  createdAt: string | null;
  galleryId: string;
}

export interface FetchDocument {
  id: string;
  title: string;
  text: string;
  url: string;
  metadata: {
    galleryId: string;
    postNo: string;
    author: string | null;
    createdAt: string | null;
    views: number | null;
    upvotes: number | null;
    commentCount: number;
    imageCount: number;
  };
  comments: Array<{
    author: string | null;
    text: string;
    createdAt: string | null;
  }>;
  imageUrls: string[];
}

export interface McpTextResponse {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}
