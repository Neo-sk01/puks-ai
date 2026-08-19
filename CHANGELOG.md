# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned
- API endpoint for programmatic access
- Multi-language support
- User feedback collection
- Query analytics dashboard

---

## [1.0.0] - 2026-06-23

### Added
- Initial release of Puks AI
- Streamlit web application with chat interface
- Hybrid retrieval system (FAISS + BM25)
- Cross-encoder reranking for precision
- Multi-model support (Llama 4, Qwen 3, Llama 3.1)
- Conversation memory (8 turns)
- Debug mode with retrieval transparency
- Help & Support form

### Knowledge Base
- 18 database schema definitions
- 40+ operational procedure documents
- Support ticket knowledge base
- 673 semantic chunks indexed

### Documentation
- Complete technical documentation
- Deployment guides (Azure, Docker)
- Developer contribution guidelines
- User guides for Streamlit and Power Apps

### Infrastructure
- Docker support with health checks
- Docker Compose configuration
- Azure deployment templates
- CI/CD pipeline examples

---

## Version History

| Version | Date | Description |
|---------|------|-------------|
| 1.0.0 | 2026-06-23 | Initial public release |

---

## Upgrade Guide

### Upgrading to 1.x

No breaking changes expected within 1.x versions. Simply pull the latest code and restart the application.

### Data Migration

If upgrading the knowledge base:

1. Backup existing vector store
2. Run the embedding pipeline
3. Test with sample queries
4. Deploy new vector store

---

[Unreleased]: https://github.com/yourusername/puks-ai/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/yourusername/puks-ai/releases/tag/v1.0.0
