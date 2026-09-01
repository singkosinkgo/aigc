#!/usr/bin/env bash
set -euo pipefail

ssh -N -L 13306:mysql77ecea7583e8.rds.ivolces.com:3306 root@115.190.6.97
