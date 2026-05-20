#!/bin/sh

if [ "$DATABASE" = "postgres" ]
then
    echo "Waiting for postgres..."

 while ! python -c "import socket; s=socket.create_connection(('$SQL_HOST', $SQL_PORT))" 2>/dev/null; do
      sleep 0.1
    done

    echo "PostgreSQL started"
fi

exec "$@"