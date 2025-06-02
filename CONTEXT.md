# Project Context & Standards

## Architecture Overview
- Backend API built with Hono.js and TypeScript
- OpenAPI/Swagger integration for API documentation
- Layered architecture: Controllers -> Services -> Repositories
- Authentication using session-based auth
- Error handling middleware
- Response standardization
- CORS enabled

## Code Standards
- TypeScript strict mode enabled
- Clear separation of concerns using layered architecture
- Dependency injection pattern
- RESTful API endpoints under /api
- Swagger documentation at /swagger
- API Reference docs at /docs
- Error responses standardized through middleware
- Protected routes use session validation
- Environment-based configuration
- Scalable middleware pipeline

## Project Structure
/src
  /domain          # Business logic & types
  /infrastructure  # Framework & technical concerns
    /config        # Configuration files
    /middlewares   # Hono middlewares
    /pages         # Route handlers
    /schedulers    # Background jobs
  /repositories    # Data access layer
  /services        # Business services
  app.ts          # Main application setup

## API Standards  
- Base path: /api
- JSON responses
- Standard error format
- OpenAPI 3.1 specification
- Authentication required for protected routes
- Response middleware for consistent format
- CORS configured for specified origins
- Proper HTTP status codes