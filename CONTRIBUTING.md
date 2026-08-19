# Contributing to Puks AI

First off, thank you for considering contributing to Puks AI! It's people like you that make Puks AI such a great tool for Speed WMS support.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [How Can I Contribute?](#how-can-i-contribute)
- [Development Setup](#development-setup)
- [Style Guidelines](#style-guidelines)
- [Commit Messages](#commit-messages)
- [Pull Request Process](#pull-request-process)

## Code of Conduct

This project and everyone participating in it is governed by our Code of Conduct. By participating, you are expected to uphold this code. Please report unacceptable behavior to the project maintainers.

## Getting Started

### Prerequisites

- Python 3.9+ (3.11 recommended)
- Git
- A Groq API key (free tier available at [console.groq.com](https://console.groq.com))

### Quick Setup

```bash
# Fork and clone the repository
git clone https://github.com/yourusername/puks-ai.git
cd puks-ai

# Create and activate virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: .\venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Set up secrets
mkdir -p .streamlit
echo 'GROQ_API_KEY = "your-api-key"' > .streamlit/secrets.toml
```

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check existing issues to avoid duplicates. When creating a bug report, include:

- **Clear title** describing the issue
- **Steps to reproduce** the behavior
- **Expected behavior** vs actual behavior
- **Screenshots** if applicable
- **Environment details** (OS, Python version, etc.)

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. Include:

- **Use case** - Why is this enhancement useful?
- **Proposed solution** - How should it work?
- **Alternatives considered** - What other options exist?

### Adding Documentation

Documentation improvements are always welcome:

- Fix typos or clarify existing docs
- Add examples for complex features
- Improve inline code comments
- Add docstrings to functions

### Adding Knowledge Base Content

#### New Database Schemas

1. Create a JSON file in `data/database_tables/`:

```json
{
  "table_name": "NEW_DAT",
  "description": "Description of the table",
  "primary_key": "NEW_KEYU",
  "columns": [
    {
      "name": "COLUMN_NAME",
      "description": "Column description",
      "type_sql_server": "VARCHAR(50)",
      "type_oracle": "NVARCHAR2(50)",
      "is_primary_key": false,
      "is_foreign_key": false
    }
  ]
}
```

2. Run the embedding pipeline
3. Test with relevant queries
4. Submit PR

#### New Operational Procedures

1. Create a JSON file in `data/procedures/`:

```json
{
  "document_name": "Procedure Name",
  "version": "1.0",
  "category": "Category",
  "procedures": [
    {
      "name": "Step Name",
      "steps": ["Step 1", "Step 2"],
      "sql": "SELECT * FROM table",
      "safety_notes": ["Important note"]
    }
  ]
}
```

2. Run the embedding pipeline
3. Test with relevant queries
4. Submit PR

## Development Setup

### Running the Application

```bash
cd app
streamlit run APP.py
```

### Running the Data Pipeline

Execute notebooks in order:

```bash
cd notebooks
jupyter notebook 01_document_ingestion.ipynb
# Continue with 02, 03, 04...
```

### Running Tests

```bash
# Run all tests
pytest tests/

# Run with coverage
pytest --cov=app tests/
```

## Style Guidelines

### Python Code Style

- Follow [PEP 8](https://pep8.org/)
- Use type hints where possible
- Maximum line length: 100 characters
- Use meaningful variable names

```python
# Good
def retrieve_context(query: str, top_k: int = 5) -> list[dict]:
    """Retrieve relevant context chunks for a query."""
    pass

# Bad
def get(q, k=5):
    pass
```

### Docstrings

Use Google-style docstrings:

```python
def build_prompt(query: str, context: list, memory: str) -> str:
    """Build the LLM prompt from query and context.
    
    Args:
        query: The user's question
        context: List of relevant context chunks
        memory: Formatted conversation history
        
    Returns:
        Formatted prompt string for the LLM
        
    Raises:
        ValueError: If context is empty
    """
    pass
```

### JSON Schema Files

- Use consistent field naming
- Include descriptions for all fields
- Validate JSON syntax before committing

## Commit Messages

Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only
- `style`: Code style (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding tests
- `chore`: Maintenance tasks

### Examples

```
feat(retrieval): add BM25 hybrid search

Implements BM25 lexical search alongside vector search for improved
retrieval accuracy on keyword-heavy queries.

Closes #123
```

```
fix(app): handle empty context gracefully

Previously, empty retrieval results caused a KeyError. Now returns
a friendly "no information found" message.

Fixes #456
```

## Pull Request Process

### Before Submitting

1. **Update documentation** if you changed functionality
2. **Add tests** for new features
3. **Run the test suite** and ensure all tests pass
4. **Update the README** if adding new features
5. **Follow the style guidelines**

### PR Template

```markdown
## Description
Brief description of the changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Documentation update
- [ ] Knowledge base addition

## Testing
How did you test this change?

## Checklist
- [ ] My code follows the style guidelines
- [ ] I have performed a self-review
- [ ] I have added tests that prove my fix/feature works
- [ ] I have updated the documentation
- [ ] My changes generate no new warnings
```

### Review Process

1. Submit your PR with a clear description
2. Request review from maintainers
3. Address any feedback
4. Once approved, a maintainer will merge your PR

## Questions?

Feel free to open an issue for any questions about contributing. We're happy to help!

---

Thank you for contributing to Puks AI! 🚀
