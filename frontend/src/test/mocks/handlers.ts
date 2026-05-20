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
];
