import os
import time
from flask import Flask, render_template
from modules.database import init_db
from modules.routes_api import api_bp

# Pastikan proses Python di aaPanel membaca zona waktu WITA
os.environ['TZ'] = 'Asia/Makassar'
if hasattr(time, 'tzset'):
    time.tzset()

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # Batas upload 100 MB untuk multi-upload MP3
app.register_blueprint(api_bp)


@app.route('/')
def index():
    return render_template('index.html')


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=False)