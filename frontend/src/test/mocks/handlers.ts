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
    return HttpResponse.json({ review_root_name: "mock-root" });
  }),

  http.get(`${API_BASE}/api/dirs`, ({ request }) => {
    const url = new URL(request.url);
    const path = url.searchParams.get("path") ?? "";
    if (path === "") {
      return HttpResponse.json({
        entries: [
          { name: "docs", path: "docs", type: "dir" },
          { name: "README.md", path: "README.md", type: "file" },
        ],
      });
    }
    if (path === "docs") {
      return HttpResponse.json({
        entries: [
          { name: "api", path: "docs/api", type: "dir" },
          { name: "intro.md", path: "docs/intro.md", type: "file" },
        ],
      });
    }
    if (path === "docs/api") {
      return HttpResponse.json({
        entries: [{ name: "spec.md", path: "docs/api/spec.md", type: "file" }],
      });
    }
    return HttpResponse.json({ entries: [] });
  }),

  http.get(`${API_BASE}/api/files`, () => {
    return HttpResponse.json({
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
    return HttpResponse.json({ path, content: `# ${path}\n\nmock content` });
  }),

  http.put(`${API_BASE}/api/files/*`, async ({ request }) => {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/files\//, "");
    const body = (await request.json()) as { content: string };
    return HttpResponse.json({ path, content: body.content });
  }),
];
