import { http, HttpResponse } from "msw";

const API_BASE = "http://localhost:8080";

export const mockUsers = [
  {
    id: "1",
    name: "John Doe",
    email: "john@example.com",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  },
  {
    id: "2",
    name: "Jane Smith",
    email: "jane@example.com",
    createdAt: "2024-01-02T00:00:00Z",
    updatedAt: "2024-01-02T00:00:00Z",
  },
];

export const MOCK_VALID_EMAIL = "user@example.com";
export const MOCK_VALID_PASSWORD = "password123";
export const MOCK_TOKEN = "mock-jwt-token";

export const handlers = [
  http.post(`${API_BASE}/api/v1/auth/login`, async ({ request }) => {
    const body = (await request.json()) as { email: string; password: string };
    if (body.email === MOCK_VALID_EMAIL && body.password === MOCK_VALID_PASSWORD) {
      return HttpResponse.json({ token: MOCK_TOKEN });
    }
    return HttpResponse.json({ error: "invalid credentials" }, { status: 401 });
  }),

  http.get(`${API_BASE}/api/v1/users`, () => {
    return HttpResponse.json(mockUsers);
  }),

  http.get(`${API_BASE}/api/v1/users/:id`, ({ params }) => {
    const user = mockUsers.find((u) => u.id === params.id);
    if (!user) {
      return HttpResponse.json({ error: "User not found" }, { status: 404 });
    }
    return HttpResponse.json(user);
  }),

  http.post(`${API_BASE}/api/v1/users`, async ({ request }) => {
    const body = (await request.json()) as {
      name: string;
      email: string;
      password: string;
    };
    if (!body.password || body.password.length < 8) {
      return HttpResponse.json(
        { error: "password must be at least 8 characters" },
        { status: 400 }
      );
    }
    const newUser = {
      id: "3",
      name: body.name,
      email: body.email,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return HttpResponse.json(newUser, { status: 201 });
  }),

  http.put(`${API_BASE}/api/v1/users/:id`, async ({ params, request }) => {
    if (!request.headers.get("Authorization")) {
      return HttpResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const body = (await request.json()) as { name: string; email: string };
    const user = mockUsers.find((u) => u.id === params.id);
    if (!user) {
      return HttpResponse.json({ error: "User not found" }, { status: 404 });
    }
    return HttpResponse.json({
      ...user,
      name: body.name,
      email: body.email,
      updatedAt: new Date().toISOString(),
    });
  }),

  http.delete(`${API_BASE}/api/v1/users/:id`, ({ params, request }) => {
    if (!request.headers.get("Authorization")) {
      return HttpResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const user = mockUsers.find((u) => u.id === params.id);
    if (!user) {
      return HttpResponse.json({ error: "User not found" }, { status: 404 });
    }
    return new HttpResponse(null, { status: 204 });
  }),

  http.get(`${API_BASE}/api/config`, () => {
    return HttpResponse.json({
      review_root_name: "mock-root",
      review_root: "/tmp/mock-root",
      review_roots: [{ name: "mock-root", path: "/tmp/mock-root" }],
    });
  }),

  http.get(`${API_BASE}/api/dirs`, ({ request }) => {
    const url = new URL(request.url);
    const path = url.searchParams.get("path") ?? "";
    const root = url.searchParams.get("root") ?? "mock-root";
    if (path === "") {
      return HttpResponse.json({
        root,
        entries: [
          { name: "docs", path: "docs", type: "dir", modified: "2026-05-20T00:00:00Z" },
          { name: "README.md", path: "README.md", type: "file", modified: "2026-05-20T00:00:00Z" },
        ],
      });
    }
    if (path === "docs") {
      return HttpResponse.json({
        root,
        entries: [
          { name: "api", path: "docs/api", type: "dir", modified: "2026-05-20T00:00:00Z" },
          { name: "intro.md", path: "docs/intro.md", type: "file", modified: "2026-05-20T00:00:00Z" },
        ],
      });
    }
    if (path === "docs/api") {
      return HttpResponse.json({
        root,
        entries: [{ name: "spec.md", path: "docs/api/spec.md", type: "file", modified: "2026-05-20T00:00:00Z" }],
      });
    }
    return HttpResponse.json({ root, entries: [] });
  }),

  http.get(`${API_BASE}/api/files`, ({ request }) => {
    const url = new URL(request.url);
    const root = url.searchParams.get("root") ?? "mock-root";
    return HttpResponse.json({
      root,
      files: [
        { path: "README.md", size: 12, modified: "2026-05-20T00:00:00Z" },
        { path: "docs/intro.md", size: 34, modified: "2026-05-20T00:00:00Z" },
        { path: "docs/api/spec.md", size: 56, modified: "2026-05-20T00:00:00Z" },
      ],
    });
  }),

  http.get(`${API_BASE}/api/files/*`, ({ request }) => {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/files\//, "");
    const root = url.searchParams.get("root") ?? "mock-root";
    return HttpResponse.json({
      path,
      root,
      content: `# ${path}\n\nmock content`,
      modified: "2026-05-20T00:00:00Z",
      created: "2026-05-19T00:00:00Z",
      state: "draft",
    });
  }),

  http.put(`${API_BASE}/api/files/*`, async ({ request }) => {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/files\//, "");
    const root = url.searchParams.get("root") ?? "mock-root";
    const body = (await request.json()) as { content: string };
    return HttpResponse.json({
      path,
      root,
      content: body.content,
      modified: new Date().toISOString(),
      created: "2026-05-19T00:00:00Z",
      state: "draft",
    });
  }),

  http.get(`${API_BASE}/api/stat/*`, ({ request }) => {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/stat\//, "");
    const root = url.searchParams.get("root") ?? "mock-root";
    return HttpResponse.json({
      path,
      root,
      modified: "2026-05-20T00:00:00Z",
      created: "2026-05-19T00:00:00Z",
      state: "draft",
    });
  }),

  http.post(`${API_BASE}/api/ingest/*`, ({ request }) => {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/ingest\//, "");
    const root = url.searchParams.get("root") ?? "mock-root";
    return HttpResponse.json({ path, root, state: "review" });
  }),

  http.get(`${API_BASE}/api/revisions/*`, ({ request }) => {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/revisions\//, "");
    const root = url.searchParams.get("root") ?? "mock-root";
    const id = url.searchParams.get("id");
    if (id) {
      return HttpResponse.json({
        id,
        ts: "2026-05-20T00:00:00Z",
        author: "ai",
        content: `# ${path}\n\nprevious content`,
      });
    }
    return HttpResponse.json({ path, root, revisions: [] });
  }),

  http.get(`${API_BASE}/api/comments/*`, ({ request }) => {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/comments\//, "");
    const root = url.searchParams.get("root") ?? "mock-root";
    return HttpResponse.json({
      file: path,
      root,
      summary: { total: 0, by_scope: {}, by_status: {} },
      comments: [],
    });
  }),

  http.post(`${API_BASE}/api/comments/*`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json(
      {
        id: "c-001",
        scope: body.scope ?? "inline",
        body: body.body ?? "",
        author: body.author,
        date: body.date,
        status: "open",
        anchor: body.anchor,
        anchors: body.anchors,
        context: null,
        orphan: false,
      },
      { status: 201 }
    );
  }),

  http.patch(`${API_BASE}/api/comments/*`, async ({ request }) => {
    const url = new URL(request.url);
    const id = url.searchParams.get("id") ?? "c-001";
    const body = (await request.json()) as { status?: string; body?: string };
    return HttpResponse.json({
      id,
      scope: "inline",
      body: body.body ?? "",
      status: body.status ?? "open",
      context: null,
      orphan: false,
    });
  }),

  http.delete(`${API_BASE}/api/comments/*`, () => {
    return new HttpResponse(null, { status: 204 });
  }),

  http.post(`${API_BASE}/api/replies/*`, async ({ request }) => {
    const url = new URL(request.url);
    const id = url.searchParams.get("id") ?? "c-001";
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({
      id,
      scope: "inline",
      body: "",
      status: "open",
      replies: [body],
      context: null,
      orphan: false,
    });
  }),
];
