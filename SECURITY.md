# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

We take the security of Puks AI seriously. If you believe you have found a security vulnerability, please report it to us as described below.

### Please do NOT:

- Open a public GitHub issue for security vulnerabilities
- Disclose the vulnerability publicly before we have had a chance to address it

### Please DO:

1. **Email us** at security@example.com with:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Any suggested fixes (optional)

2. **Allow us time** to respond (typically within 48 hours)

3. **Work with us** to understand and resolve the issue

## What to Expect

- **Acknowledgment**: Within 48 hours of your report
- **Status Update**: Within 5 business days
- **Resolution Timeline**: Depends on severity
  - Critical: 24-48 hours
  - High: 1 week
  - Medium: 2 weeks
  - Low: Next release

## Security Best Practices

When deploying Puks AI:

### Secrets Management

- Never commit API keys to version control
- Use environment variables or secrets management (Azure Key Vault)
- Rotate API keys regularly

### Network Security

- Deploy behind a reverse proxy (nginx, Azure Application Gateway)
- Enable HTTPS/TLS
- Implement rate limiting
- Use Web Application Firewall (WAF) in production

### Access Control

- Implement authentication for production deployments
- Use Azure AD integration where possible
- Follow principle of least privilege

### Data Protection

- No PII should be stored in the knowledge base
- Audit access to sensitive procedures
- Log all queries for audit trail (without sensitive data)

## Known Security Considerations

### LLM Guardrails

The system implements several guardrails:

1. **Context-only responses**: The LLM can only answer from provided context
2. **No database modifications**: SQL generation limited to SELECT queries by default
3. **Confidence thresholds**: Low-confidence responses trigger fallback messages
4. **Input validation**: Query length and content validation

### Data Residency

- Vector store can be deployed in any Azure region
- LLM inference, embeddings and reranking run on AGL's own Azure Foundry
  resource in West Europe. No request leaves the tenant. Note that the `gpt-5`
  deployment is `GlobalStandard`, which may route inference outside the EU —
  `DataZoneStandard` confines it to EU member states and the SKU cannot be
  changed in place.
- Consider self-hosted LLM for strict data residency requirements

## Security Updates

Security updates will be released as patch versions (e.g., 1.0.1, 1.0.2) and announced in:

- GitHub Security Advisories
- Release notes
- Email to registered users (if applicable)

---

Thank you for helping keep Puks AI and its users safe!
