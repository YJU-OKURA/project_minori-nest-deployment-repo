import {
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LangchainConfig } from '@common/configs/config.interface';
import { PDFLoader } from 'langchain/document_loaders/fs/pdf';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { OpenAIEmbeddings } from '@langchain/openai';
import { FaissStore } from '@langchain/community/vectorstores/faiss';
import { Document } from '@langchain/core/documents';
import { Tiktoken, get_encoding } from 'tiktoken';

@Injectable()
export class LangchainService {
  private readonly langchainConfig: LangchainConfig;
  private tokenizer: Tiktoken;

  constructor(
    private readonly configService: ConfigService,
  ) {
    this.langchainConfig =
      this.configService.get<LangchainConfig>('langchain');

    this.tokenizer = get_encoding('cl100k_base');
  }

  /**
   * ファイルからベクトルを作成し、そのパスをリターン
   * @param file - ベクトルを作成するファイル
   * @param c_id - クラスID
   * @returns - 作成したベクトルのパス
   */
  async vectorCreate(
    file: Express.Multer.File,
    c_id: string,
  ): Promise<string> {
    let blob: Blob;
    try {
      blob = new Blob([file.buffer]);
    } catch (error) {
      throw new InternalServerErrorException(
        'Blob creation failed',
      );
    }

    let docs: Document[];
    try {
      docs = await this.splitDocument(blob);
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to split document',
      );
    }

    const path = `${
      this.langchainConfig.localStoragePath
    }/class${c_id}/${new Date().getTime()}`;

    try {
      await this.saveVector(docs, path);
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to save vector',
      );
    }

    return path;
  }

  /**
   * ドキュメントを分割
   * @param blob - 分割するドキュメント
   * @returns - 分割されたドキュメント
   */
  private async splitDocument(
    blob: Blob,
  ): Promise<Document[]> {
    const loader = new PDFLoader(blob);
    const pages = await loader.loadAndSplit();

    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 200,
      chunkOverlap: 20,
      lengthFunction: this.tiktoken_len,
    });

    return await splitter.splitDocuments(pages);
  }

  /**
   * ベクトルを保存
   * @param docs - ベクトルを作成するドキュメント
   * @param path - 保存するパス
   */
  private async saveVector(
    docs: Document[],
    path: string,
  ): Promise<void> {
    const embeddingsModel = new OpenAIEmbeddings({
      openAIApiKey: this.langchainConfig.openAIApiKey,
    });

    const db = await FaissStore.fromDocuments(
      docs,
      embeddingsModel,
    );
    await db.save(path);
  }

  private tiktoken_len = (text: string) => {
    return this.tokenizer.encode(text).length;
  };
}
