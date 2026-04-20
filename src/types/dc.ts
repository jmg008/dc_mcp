export const TARGET_GALLERY_ID = "thesingularity";

export interface DcListItem {
  id: string;
  postNo: string;
  galleryId: string;
  title: string;
  url: string;
  subject?: string;
  author?: string;
  createdAt?: string;
  commentCount?: number;
  views?: number;
  upvotes?: number;
  raw: unknown;
}

export interface DcComment {
  commentNo?: string;
  author?: string;
  text: string;
  createdAt?: string;
  depth?: number;
  deleted?: boolean;
}

export interface DcPost {
  id: string;
  postNo: string;
  galleryId: string;
  title: string;
  subject?: string;
  bodyText: string;
  comments: DcComment[];
  imageUrls: string[];
  url: string;
  author?: string;
  createdAt?: string;
  views?: number;
  upvotes?: number;
  commentCount?: number;
  raw: unknown;
}
