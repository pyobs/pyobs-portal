# pull official base image
FROM python:3.14-slim-trixie
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# set work directory
WORKDIR /src

# set environment variables
ENV PYTHONDONTWRITEBYTECODE 1
ENV PYTHONUNBUFFERED 1
ENV UV_NO_DEV=1

# copy
COPY . .

# install dependencies
RUN uv sync --locked

# entrypoint
RUN sed -i 's/\r$//g' /src/entrypoint.sh
RUN chmod +x /src/entrypoint.sh

# run entrypoint.sh
ENTRYPOINT ["/src/entrypoint.sh"]