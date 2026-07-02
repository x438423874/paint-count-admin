"""
PaddleOCR 3.7.0 FastAPI 微服务
端口: 8500
功能: 提供全图识别和区域识别接口，支持蓝字紫底/红底蓝字等特殊图片的智能预处理
"""
import os
import io
import base64
import logging
from typing import Optional, List, Tuple
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from PIL import Image
import numpy as np
import cv2

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ocr-service")

app = FastAPI(title="PaddleOCR Service", version="1.0.0")

# 允许跨域
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 全局 OCR 实例（懒加载）
_ocr_instance = None


def get_ocr():
    """懒加载 PaddleOCR 实例"""
    global _ocr_instance
    if _ocr_instance is None:
        logger.info("初始化 PaddleOCR 3.7.0...")
        from paddleocr import PaddleOCR

        _ocr_instance = PaddleOCR(
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,  # 关闭文字行方向分类，加速推理
            engine="paddle",
            lang='ch',
            text_det_thresh=0.3,   # 降低检测阈值，提高检测率
            text_det_box_thresh=0.5,
            text_recognition_batch_size=6,
        )
        logger.info("PaddleOCR 初始化完成")
    return _ocr_instance


def detect_image_type(img_array: np.ndarray) -> str:
    """
    检测图片类型：普通、蓝字紫底、红底蓝字、低对比度等
    通过采样像素分析颜色特征
    """
    h, w = img_array.shape[:2]
    if len(img_array.shape) == 2:
        return 'grayscale'

    # 采样像素（避免全图扫描太慢）
    step = max(1, min(h, w) // 100)
    pixels = img_array[::step, ::step].reshape(-1, 3).astype(np.float32)

    r_mean = np.mean(pixels[:, 0])
    g_mean = np.mean(pixels[:, 1])
    b_mean = np.mean(pixels[:, 2])

    # 蓝色优势度：蓝色通道 - max(红色, 绿色)
    blue_advantage = b_mean - max(r_mean, g_mean)
    # 红色优势度
    red_advantage = r_mean - max(g_mean, b_mean)
    # 整体亮度
    brightness = (r_mean + g_mean + b_mean) / 3
    # 对比度（标准差）
    contrast = np.std(pixels)
    # 色彩饱和度
    saturation = np.std([r_mean, g_mean, b_mean])

    logger.info(f"图片特征: R={r_mean:.0f}, G={g_mean:.0f}, B={b_mean:.0f}, "
                f"蓝色优势={blue_advantage:.0f}, 红色优势={red_advantage:.0f}, "
                f"亮度={brightness:.0f}, 对比度={contrast:.0f}, 饱和度={saturation:.0f}")

    # 判断类型
    if blue_advantage > 15 and saturation > 30:
        return 'blue_on_purple'  # 蓝字紫底
    elif red_advantage > 20 and blue_advantage > -10 and saturation > 25:
        return 'red_bg'  # 红底（可能有蓝字或黑字）
    elif contrast < 40:
        return 'low_contrast'  # 低对比度
    else:
        return 'normal'


def preprocess_for_blue_on_purple(img_array: np.ndarray) -> np.ndarray:
    """
    蓝字紫底专用预处理
    原理：蓝字的 B 通道值高，紫底的 R+G 也高
    处理：提取蓝色优势 → 二值化
    """
    # 转换到 float32
    img_float = img_array.astype(np.float32)

    # 方法1：蓝色通道分离
    # 蓝字区域：B > R 且 B > G
    b_ch = img_float[:, :, 2]  # Blue
    r_ch = img_float[:, :, 0]  # Red
    g_ch = img_float[:, :, 1]  # Green

    # 蓝色优势图：B - max(R, G)
    blue_advantage = b_ch - np.maximum(r_ch, g_ch)

    # 归一化到 0-255
    blue_advantage = (blue_advantage - blue_advantage.min()) / (blue_advantage.max() - blue_advantage.min() + 1e-8) * 255

    # 自适应二值化
    _, binary = cv2.threshold(blue_advantage.astype(np.uint8), 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    # 反转：文字变白，背景变黑（PaddleOCR 期望黑字白底或白字黑底均可）
    result = 255 - binary

    logger.info(f"蓝字紫底预处理完成")
    return result


def preprocess_for_red_bg(img_array: np.ndarray) -> np.ndarray:
    """
    红底专用预处理（如红色工单纸）
    原理：去除红色背景，保留非红色文字
    """
    img_float = img_array.astype(np.float32)

    # 提取非红色区域
    r_ch = img_float[:, :, 0]
    g_ch = img_float[:, :, 1]
    b_ch = img_float[:, :, 2]

    # 红色背景的特征：R 很高，G 和 B 较低
    red_dominance = r_ch - np.maximum(g_ch, b_ch)

    # 非红色区域（文字）：红色优势低的区域
    non_red = 255 - np.clip(red_dominance * 2, 0, 255).astype(np.uint8)

    # 同时用灰度图做参考
    gray = cv2.cvtColor(img_array, cv2.COLOR_RGB2GRAY)

    # 合并：非红色区域 AND 高对比度灰度
    _, gray_binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    # 取两者交集（更保守但更准确）
    result = cv2.bitwise_and(non_red, gray_binary)

    # 形态学操作：去除小噪点
    kernel = np.ones((2, 2), np.uint8)
    result = cv2.morphologyEx(result, cv2.MORPH_OPEN, kernel)

    logger.info(f"红底预处理完成")
    return result


def preprocess_enhance_contrast(img_array: np.ndarray) -> np.ndarray:
    """
    低对比度图片增强
    使用 CLAHE（限制对比度的自适应直方图均衡化）
    """
    if len(img_array.shape) == 3:
        # 彩色图像：转换到 LAB 空间，只对 L 通道做 CLAHE
        lab = cv2.cvtColor(img_array, cv2.COLOR_RGB2LAB)
        l, a, b = cv2.split(lab)
        clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
        l = clahe.apply(l)
        enhanced = cv2.merge([l, a, b])
        result = cv2.cvtColor(enhanced, cv2.COLOR_LAB2RGB)
    else:
        # 灰度图像
        clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
        result = clahe.apply(img_array)

    logger.info(f"对比度增强完成")
    return result


def preprocess_denoise(img_array: np.ndarray) -> np.ndarray:
    """
    去噪 + 锐化预处理
    适用于模糊或有噪点的图片
    """
    # 先去噪
    if len(img_array.shape) == 3:
        denoised = cv2.fastNlMeansDenoisingColored(img_array, None, 10, 10, 7, 21)
    else:
        denoised = cv2.fastNlMeansDenoising(img_array, None, 10, 7, 21)

    # 再锐化（拉普拉斯锐化）
    if len(denoised.shape) == 3:
        gray = cv2.cvtColor(denoised, cv2.COLOR_RGB2GRAY)
    else:
        gray = denoised

    # 使用 USM（Unsharp Masking）锐化
    blurred = cv2.GaussianBlur(gray, (0, 0), 3)
    sharpened = cv2.addWeighted(gray, 1.5, blurred, -0.5, 0)

    logger.info(f"去噪锐化完成")
    return sharpened


def preprocess_adaptive_threshold(img_array: np.ndarray) -> np.ndarray:
    """
    自适应二值化预处理
    适用于光照不均的图片，比全局 OTSU 更精细
    """
    if len(img_array.shape) == 3:
        gray = cv2.cvtColor(img_array, cv2.COLOR_RGB2GRAY)
    else:
        gray = img_array.copy()

    # 自适应二值化（局部区域计算阈值）
    result = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY, 31, 10
    )

    # 形态学操作：连接断裂的文字笔画
    kernel = np.ones((1, 2), np.uint8)
    result = cv2.morphologyEx(result, cv2.MORPH_CLOSE, kernel)

    logger.info(f"自适应二值化完成")
    return result


def preprocess_resize_enhance(img_array: np.ndarray, scale: int = 2) -> np.ndarray:
    """
    放大图片并增强（适用于小文字）
    使用 Lanczos 插值放大后做锐化
    """
    h, w = img_array.shape[:2]
    enlarged = cv2.resize(img_array, (w * scale, h * scale), interpolation=cv2.INTER_LANCZOS4)

    # 放大后做轻度锐化
    if len(enlarged.shape) == 3:
        gray = cv2.cvtColor(enlarged, cv2.COLOR_RGB2GRAY)
    else:
        gray = enlarged

    blurred = cv2.GaussianBlur(gray, (0, 0), 1)
    sharpened = cv2.addWeighted(gray, 1.3, blurred, -0.3, 0)

    logger.info(f"放大增强完成: {w}x{h} -> {w*scale}x{h*scale}")
    return sharpened


def smart_preprocess(img_array: np.ndarray) -> List[Tuple[str, np.ndarray]]:
    """
    智能预处理：根据图片类型生成预处理结果
    返回 [(策略名, 处理后图像), ...]
    
    优化：只生成2-3种最有效的策略，避免过多OCR调用导致超时
    """
    image_type = detect_image_type(img_array)
    strategies = []

    # 策略1：原图（始终包含，作为基准）
    strategies.append(('original', img_array))

    # 根据图片类型选择1-2种最有效的预处理策略
    if image_type == 'blue_on_purple':
        # 蓝字紫底：专用颜色通道分离（最有效）
        preprocessed = preprocess_for_blue_on_purple(img_array)
        strategies.append(('blue_on_purple', preprocessed))

    elif image_type == 'red_bg':
        # 红底：去红处理（最有效）
        preprocessed = preprocess_for_red_bg(img_array)
        strategies.append(('red_bg_removed', preprocessed))

    elif image_type == 'low_contrast':
        # 低对比度：CLAHE 增强
        enhanced = preprocess_enhance_contrast(img_array)
        strategies.append(('clahe_enhanced', enhanced))

    else:
        # 普通图片：去噪+锐化
        denoised = preprocess_denoise(img_array)
        strategies.append(('denoised', denoised))

    # 小图放大增强（仅当图片较小时）
    h, w = img_array.shape[:2]
    if w < 1500 or h < 1000:
        enlarged = preprocess_resize_enhance(img_array, 2)
        strategies.append(('resize_enhanced', enlarged))

    logger.info(f"生成了 {len(strategies)} 种预处理策略 (类型={image_type})")
    return strategies


@app.get("/health")
async def health():
    """健康检查"""
    return {"status": "ok", "service": "paddle-ocr", "version": "3.7.0"}


@app.post("/ocr")
async def ocr_recognize(
    file: UploadFile = File(...),
):
    """
    全图 OCR 识别（智能预处理版）
    自动检测图片类型，使用多策略预处理，返回最佳结果
    """
    try:
        image_bytes = await file.read()
        image = Image.open(io.BytesIO(image_bytes))
        img_array = np.array(image.convert('RGB'))

        # 优化：大图缩小到合理尺寸，加速OCR推理
        # PaddleOCR 对 1200px 宽度的图片识别效果已经很好，更大尺寸只会增加推理时间
        h, w = img_array.shape[:2]
        MAX_DIM = 1200
        max_side = max(w, h)
        if max_side > MAX_DIM:
            scale = MAX_DIM / max_side
            new_w = int(w * scale)
            new_h = int(h * scale)
            img_array = cv2.resize(img_array, (new_w, new_h), interpolation=cv2.INTER_AREA)
            logger.info(f"大图缩小: {w}x{h} -> {new_w}x{new_h}")

        # 智能预处理
        strategies = smart_preprocess(img_array)

        ocr = get_ocr()

        # 多策略识别，取文本数量最多且置信度最高的结果
        # 优化：如果原图识别结果已经足够好，提前终止
        best_texts = []
        best_total_score = 0
        MIN_GOOD_SCORE = 1500  # 足够好的阈值（约10个文本块+高置信度）

        for strategy_name, processed_img in strategies:
            try:
                result = ocr.predict(processed_img)

                texts = parse_ocr_result(result)
                total_confidence = sum(t['confidence'] for t in texts)
                total_score = len(texts) * 50 + total_confidence  # 数量权重 + 置信度权重

                logger.info(f"策略 [{strategy_name}]: 识别到 {len(texts)} 个文本块, 总分={total_score:.0f}")

                if total_score > best_total_score:
                    best_total_score = total_score
                    best_texts = texts
                    logger.info(f"  → 当前最佳策略: {strategy_name}")

                # 提前终止：如果结果已经足够好，不再尝试更多策略
                if best_total_score >= MIN_GOOD_SCORE:
                    logger.info(f"结果已足够好 (分数={best_total_score:.0f})，提前终止")
                    break
            except Exception as e:
                logger.warning(f"策略 [{strategy_name}] 识别失败: {e}")

        return {
            "success": True,
            "texts": best_texts,
            "count": len(best_texts),
        }
    except Exception as e:
        logger.error(f"OCR 识别失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"OCR 识别失败: {str(e)}")


def parse_ocr_result(result):
    """解析 PaddleOCR 返回结果"""
    texts = []
    if result and len(result) > 0:
        res = result[0]
        if isinstance(res, dict):
            rec_texts = res.get("rec_texts", [])
            rec_scores = res.get("rec_scores", [])
            dt_polys = res.get("dt_polys", [])

            for i, text in enumerate(rec_texts):
                confidence = rec_scores[i] if i < len(rec_scores) else 0
                box = []
                if i < len(dt_polys):
                    poly = dt_polys[i]
                    if hasattr(poly, "tolist"):
                        box = poly.tolist()
                    elif isinstance(poly, np.ndarray):
                        box = poly.tolist()
                    else:
                        box = list(poly)

                texts.append({
                    "text": text,
                    "confidence": float(confidence),
                    "box": box,
                })
        else:
            for line in res:
                if len(line) >= 2:
                    box = line[0]
                    text_info = line[1]
                    texts.append({
                        "text": text_info[0] if isinstance(text_info, tuple) else str(text_info),
                        "confidence": float(text_info[1]) if isinstance(text_info, tuple) and len(text_info) > 1 else 0,
                        "box": box if isinstance(box, list) else [],
                    })

    return texts


@app.post("/ocr/region")
async def ocr_region_recognize(
    file: UploadFile = File(...),
    x: int = Form(0),
    y: int = Form(0),
    width: int = Form(0),
    height: int = Form(0),
):
    """
    区域 OCR 识别（带智能预处理）
    """
    try:
        image_bytes = await file.read()
        image = Image.open(io.BytesIO(image_bytes))

        # 裁剪区域
        if width > 0 and height > 0:
            img_w, img_h = image.size
            x = max(0, min(x, img_w - 1))
            y = max(0, min(y, img_h - 1))
            width = min(width, img_w - x)
            height = min(height, img_h - y)
            image = image.crop((x, y, x + width, y + height))
            logger.info(f"裁剪区域: ({x}, {y}, {width}, {height}), 图片尺寸: {image.size}")

        # 放大小区域
        img_w, img_h = image.size
        if img_w < 500 or img_h < 100:
            scale = 2
            image = image.resize((img_w * scale, img_h * scale), Image.LANCZOS)
            logger.info(f"放大到: {image.size}")

        img_array = np.array(image.convert('RGB'))

        # 智能预处理
        strategies = smart_preprocess(img_array)
        ocr = get_ocr()

        best_texts = []
        best_score = 0
        MIN_REGION_SCORE = 50  # 区域识别足够好的阈值

        for strategy_name, processed_img in strategies:
            try:
                result = ocr.predict(processed_img)
                texts = []
                if result and len(result) > 0:
                    res = result[0]
                    if isinstance(res, dict):
                        rec_texts = res.get("rec_texts", [])
                        rec_scores = res.get("rec_scores", [])
                        for i, text in enumerate(rec_texts):
                            conf = rec_scores[i] if i < len(rec_scores) else 0
                            texts.append({"text": text, "confidence": float(conf)})
                score = sum(t['confidence'] for t in texts) * len(texts)
                if score > best_score:
                    best_score = score
                    best_texts = texts

                # 提前终止：区域识别结果足够好时停止
                if best_score >= MIN_REGION_SCORE and len(best_texts) > 0:
                    logger.info(f"区域 [{strategy_name}] 结果已足够好，提前终止")
                    break
            except Exception as e:
                logger.warning(f"区域策略 [{strategy_name}] 失败: {e}")

        combined_text = " ".join([t["text"] for t in best_texts])

        return {
            "success": True,
            "texts": best_texts,
            "combined_text": combined_text,
            "count": len(best_texts),
        }
    except Exception as e:
        logger.error(f"区域 OCR 识别失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"区域 OCR 识别失败: {str(e)}")


@app.post("/ocr/regions")
async def ocr_regions_recognize(
    file: UploadFile = File(...),
    regions: str = Form(...),
):
    """
    批量区域 OCR 识别（带智能预处理）
    """
    import json

    try:
        region_list = json.loads(regions)
        logger.info(f"批量识别 {len(region_list)} 个区域")

        image_bytes = await file.read()
        image = Image.open(io.BytesIO(image_bytes))
        img_w, img_h = image.size

        ocr = get_ocr()
        results = {}

        for region in region_list:
            field = region.get("field", "")
            x = region.get("x", 0)
            y = region.get("y", 0)
            w = region.get("width", 0)
            h = region.get("height", 0)

            if w <= 0 or h <= 0:
                results[field] = {"text": "", "confidence": 0}
                continue

            # 裁剪区域
            rx = max(0, min(x, img_w - 1))
            ry = max(0, min(y, img_h - 1))
            rw = min(w, img_w - rx)
            rh = min(h, img_h - ry)

            cropped = image.crop((rx, ry, rx + rw, ry + rh))

            # 放大小区域
            cw, ch = cropped.size
            if cw < 500 or ch < 100:
                cropped = cropped.resize((cw * 2, ch * 2), Image.LANCZOS)

            img_array = np.array(cropped.convert('RGB'))

            # 智能预处理
            strategies = smart_preprocess(img_array)

            best_texts = []
            best_score = 0

            for strategy_name, processed_img in strategies:
                try:
                    result = ocr.predict(processed_img)
                    texts = []
                    if result and len(result) > 0:
                        res = result[0]
                        if isinstance(res, dict):
                            rec_texts = res.get("rec_texts", [])
                            rec_scores = res.get("rec_scores", [])
                            for i, text in enumerate(rec_texts):
                                conf = rec_scores[i] if i < len(rec_scores) else 0
                                texts.append({"text": text, "confidence": float(conf)})
                    score = sum(t['confidence'] for t in texts) * len(texts)
                    if score > best_score:
                        best_score = score
                        best_texts = texts

                    # 提前终止
                    if best_score >= 50 and len(best_texts) > 0:
                        break
                except Exception as e:
                    logger.warning(f"字段{field}策略[{strategy_name}]失败: {e}")

            combined_text = " ".join([t["text"] for t in best_texts])
            avg_confidence = sum(t["confidence"] for t in best_texts) / len(best_texts) if best_texts else 0

            results[field] = {
                "text": combined_text,
                "confidence": avg_confidence,
                "details": best_texts,
            }

            logger.info(f"字段 {field}: text='{combined_text}', confidence={avg_confidence:.1f}%")

        return {
            "success": True,
            "results": results,
        }
    except Exception as e:
        logger.error(f"批量区域 OCR 识别失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"批量区域 OCR 识别失败: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8500)
