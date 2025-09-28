<p align="center">
  <img src="pics/FormBuilderLogo.png" alt="Project Logo" width="500"/>
</p>

<h1 align="center">📝Dynamic Form Builder📝</h1>

A containerized form builder that generates dynamic forms from YAML configurations and dispatches automation workflows via GitHub Actions. Designed to bridge the gap between development teams and enterprise form management systems.

## Problem Statement

Enterprise organizations often face coordination challenges between development teams building automation workflows and specialized form creation teams managing platforms like ServiceNow, Sailpoint, and other ITSM tools. This disconnect can result in:

- Development bottlenecks waiting for form creation resources
- Misaligned requirements between technical implementations and user-facing forms
- Extended time-to-market for automation initiatives
- Limited ability to prototype and test form-driven workflows

## Solution

Form Builder that provides a self-service prototyping environment that enables development teams to:

- **Rapidly prototype forms** using intuitive YAML configuration
- **Test automation workflows** with realistic form data structures
- **Generate standardized specifications** for enterprise form creation teams
- **Maintain development velocity** while formal forms are being developed

The platform serves as a communication bridge, allowing developers to create functional prototypes that can be easily translated into production forms by specialized teams when resources become available.

## Key Benefits

### For Development Teams
- Immediate form prototyping without dependencies
- Real-time testing of GitHub Actions workflows
- Standardized YAML format for consistent specifications
- MongoDB integration for persistent configuration management

### For Form Creation Teams
- Clear, structured requirements in YAML format
- Pre-tested form logic and field relationships
- Reduced back-and-forth during requirements gathering
- Seamless translation path to enterprise platforms

### For Organizations
- Accelerated automation delivery
- Improved collaboration between technical and operational teams
- Reduced coordination overhead
- Enhanced quality through early prototyping

## Architecture

- **Frontend**: Single-page application with dynamic form rendering
- **Backend**: Flask API with MongoDB integration
- **Integration**: Direct GitHub Actions workflow dispatch
- **Configuration**: Human-readable YAML specifications

## Workflow

1. **Prototype**: Developers create and test forms using YAML configuration
2. **Validate**: Test automation workflows with realistic form data
3. **Handoff**: Share validated YAML specifications with form creation teams
4. **Implement**: Form teams translate specifications to production platforms
5. **Deploy**: Seamless transition from prototype to production

## Quick Start
```bash
# Clone the repository
git clone https://github.com/MBarc/dynamic-form-builder.git
cd dynamic-form-builder

# Start infrastructure
docker-compose up -d
