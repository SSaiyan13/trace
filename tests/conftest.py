import os
import sys

# Let tests import the pipeline modules directly (they are plain scripts, not a package).
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "pipeline"))
