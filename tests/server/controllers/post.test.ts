import { Response } from 'express';
import nock from 'nock';
import { Types } from 'mongoose';
import { addPin, generateAIimage } from '../../../server/controllers/post';
import pins from '../../../server/models/pins'; // schema for pins
import pinLinks from '../../../server/models/pinlinks';
import savedTags from '../../../server/models/tags';
import aiGenerated from '../../../server/models/AI_generated';
import {
  user, rawPinsStub,
} from '../stub';
import { genericRequest } from '../interfaces';
import { PopulatedPinType } from '../../../server/interfaces';

/* AWS S3 mocks */
const mockS3Instance = {
  send: jest.fn(() => Promise.resolve()),
};
let mockPutObjectCommand: ()=>void;
jest.mock('@aws-sdk/client-s3', () => {
  mockPutObjectCommand = jest.fn();
  return {
    S3Client: jest.fn(() => mockS3Instance),
    PutObjectCommand: mockPutObjectCommand,
  };
});

/* Mock open ai api */
const mockOpenAiInstance = {
  images: {
    generate: jest.fn(() => Promise.resolve({ data: [{ url: 'http:/stub-ai-image-url' }] })),
  },
  chat: {
    completions: {
      create: jest.fn(() => Promise.resolve({ choices: [{ message: { content: '["TEST-LABEL-A", "TEST-LABEL-B"]' } }] })),
    },
  },
};

jest.mock('openai', () => jest.fn(() => mockOpenAiInstance));

/* Mongoose mocks */
const setupMocks = (response: PopulatedPinType[] | unknown = rawPinsStub) => {
  pins.find = jest.fn().mockImplementation(
    () => ({
      exec: jest.fn().mockResolvedValue([]),
    }),
  );
  pins.create = jest.fn().mockResolvedValue(response);
  pins.findByIdAndUpdate = jest.fn().mockResolvedValue([]);
  savedTags.create = jest.fn().mockResolvedValue([]);
};

describe('Adding a pin', () => {
  let res:{
    json: jest.Mock,
  };
  beforeEach(() => {
    process.env = {
      ...process.env,
      S3_BUCKET_NAME: 'pinterest.clone',
      AWS_ACCESS_KEY_ID: 'stub_Id',
      AWS_SECRET_KEY: 'stub key',
    };
    res = { json: jest.fn() };
    pinLinks.create = jest.fn().mockResolvedValue({});
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('will create a new pin after uploading to S3 for https:// protocol', async () => {
    const req = {
      user,
      body: {
        owner: {
          name: 'tester-twitter',
          service: 'twitter',
          id: user._id,
        },
        imgDescription: 'description-4',
        imgLink: 'https://stub-4',
        _id: 123,
      },
    };

    nock('https://stub-4')
      .get('/')
      .reply(200, 'Processed Image data');

    setupMocks({
      owner: {
        name: 'tester-twitter',
        service: 'twitter',
        id: user._id,
      },
      imgDescription: 'description-4',
      imgLink: 'https://stub-4',
      _id: 123,
    });
    await addPin(req as genericRequest, res as unknown as Response);
    expect(pins.create).toHaveBeenCalledTimes(1);
    expect(pins.create).toHaveBeenCalledWith({
      ...req.body,
      owner: Types.ObjectId(user._id),
      originalImgLink: req.body.imgLink,
      imgLink: expect.stringContaining('https://s3.amazonaws.com/pinterest.clone/'),
      isBroken: false,
    });
    expect(pinLinks.create).toHaveBeenCalledWith({
      cloudFrontLink: expect.any(String),
      imgLink: expect.any(String),
      pin_id: '123',
    });
    expect(res.json).toHaveBeenCalledWith({ ...req.body });
    expect(mockPutObjectCommand).toHaveBeenCalledWith({
      Bucket: 'pinterest.clone',
      Key: expect.any(String),
      Body: Buffer.from('Processed Image data'),
      ContentType: 'image/png',
      Tagging: 'userId=5cad310f7672ca00146485a8&name=tester-twitter&service=twitter',
    });
    // assert for cloud vision api labeling
    expect(pins.findByIdAndUpdate).toHaveBeenCalledTimes(1);
    expect(pins.findByIdAndUpdate).toHaveBeenCalledWith(
      123,
      {
        $set: {
          tags: [{ tag: 'TEST-LABEL-A' }, { tag: 'TEST-LABEL-B' }],
          visionApiTags: ['TEST-LABEL-A', 'TEST-LABEL-B'],
        },
      },
    );
    // assert for saving new labels
    await Promise.resolve();
    expect(savedTags.create).toHaveBeenCalledTimes(2);
    expect(savedTags.create).toHaveBeenNthCalledWith(1, { tag: 'TEST-LABEL-A' });
    expect(savedTags.create).toHaveBeenNthCalledWith(2, { tag: 'TEST-LABEL-B' });
  });

  test('will create a new pin after uploading to S3 for data:image/ protocol', async () => {
    const req = {
      user,
      body: {
        owner: {
          name: 'tester-twitter',
          service: 'twitter',
          id: user._id,
        },
        imgDescription: 'description-4',
        imgLink: 'data:image/jpeg;base64,/stub-4-data-protocol/',
        _id: 123,
      },
    };
    setupMocks({ ...req.body });
    await addPin(req as genericRequest, res as unknown as Response);
    expect(pins.create).toHaveBeenCalledTimes(1);
    expect(pins.create).toHaveBeenCalledWith({
      ...req.body,
      owner: Types.ObjectId(user._id),
      originalImgLink: req.body.imgLink,
      imgLink: expect.stringContaining('https://s3.amazonaws.com/pinterest.clone/'),
      isBroken: false,
    });
    expect(res.json).toHaveBeenCalledWith({ ...req.body });
    expect(mockPutObjectCommand).toHaveBeenCalledWith({
      Bucket: 'pinterest.clone',
      Key: expect.any(String),
      Body: Buffer.from('/stub-4-data-protocol/', 'base64'),
      ContentType: 'image/png',
      Tagging: 'userId=5cad310f7672ca00146485a8&name=tester-twitter&service=twitter',
    });
    // assert for cloud vision api labeling
    expect(pins.findByIdAndUpdate).toHaveBeenCalledTimes(1);
    expect(pins.findByIdAndUpdate).toHaveBeenCalledWith(
      123,
      {
        $set: {
          tags: [{ tag: 'TEST-LABEL-A' }, { tag: 'TEST-LABEL-B' }],
          visionApiTags: ['TEST-LABEL-A', 'TEST-LABEL-B'],
        },
      },
    );
    // assert for saving new labels
    await Promise.resolve();
    expect(savedTags.create).toHaveBeenCalledTimes(2);
    expect(savedTags.create).toHaveBeenNthCalledWith(1, { tag: 'TEST-LABEL-A' });
    expect(savedTags.create).toHaveBeenNthCalledWith(2, { tag: 'TEST-LABEL-B' });
  });

  test('will keep original link on pin but not upload to S3 for an invalid url', async () => {
    const req = {
      user,
      body: {
        owner: {
          name: 'tester-twitter',
          service: 'twitter',
          id: user._id,
        },
        imgDescription: 'description-4',
        imgLink: 'htt://stub-4',
        _id: 123,
      },
    };
    mockS3Instance.send.mockClear();
    setupMocks({ ...req.body });
    await addPin(req as genericRequest, res as unknown as Response);
    expect(pins.create).toHaveBeenCalledTimes(1);
    expect(pins.create).toHaveBeenCalledWith({
      ...req.body,
      owner: Types.ObjectId(user._id),
      originalImgLink: req.body.imgLink,
      imgLink: 'htt://stub-4',
      isBroken: false,
    });
    expect(res.json).toHaveBeenCalledWith({ ...req.body });
    expect(mockS3Instance.send).not.toHaveBeenCalled();
    // assert for cloud vision api labeling
    expect(pins.findByIdAndUpdate).toHaveBeenCalledTimes(1);
    expect(pins.findByIdAndUpdate).toHaveBeenCalledWith(
      123,
      {
        $set: {
          tags: [{ tag: 'TEST-LABEL-A' }, { tag: 'TEST-LABEL-B' }],
          visionApiTags: ['TEST-LABEL-A', 'TEST-LABEL-B'],
        },
      },
    );
    // assert for saving new labels
    await Promise.resolve();
    expect(savedTags.create).toHaveBeenCalledTimes(2);
    expect(savedTags.create).toHaveBeenNthCalledWith(1, { tag: 'TEST-LABEL-A' });
    expect(savedTags.create).toHaveBeenNthCalledWith(2, { tag: 'TEST-LABEL-B' });
  });

  test('will keep original link on pin if invalid AWS credentials used to upload', async () => {
    process.env = {
      ...process.env,
      AWS_ACCESS_KEY_ID: undefined,
      AWS_SECRET_KEY: 'stub key',
    };
    const req = {
      user,
      body: {
        owner: {
          name: 'tester-twitter',
          service: 'twitter',
          id: user._id,
        },
        imgDescription: 'description-4',
        imgLink: 'https://stub-4',
        _id: 123,
      },
    };
    mockS3Instance.send.mockClear();
    setupMocks({ ...req.body });
    await addPin(req as genericRequest, res as unknown as Response);
    expect(pins.create).toHaveBeenCalledTimes(1);
    expect(pins.create).toHaveBeenCalledWith({
      ...req.body,
      owner: Types.ObjectId(user._id),
      originalImgLink: req.body.imgLink,
      imgLink: 'https://stub-4',
      isBroken: false,
    });
    expect(res.json).toHaveBeenCalledWith({ ...req.body });
    expect(mockS3Instance.send).not.toHaveBeenCalled();
    // assert for cloud vision api labeling
    expect(pins.findByIdAndUpdate).toHaveBeenCalledTimes(1);
    expect(pins.findByIdAndUpdate).toHaveBeenCalledWith(
      123,
      {
        $set: {
          tags: [{ tag: 'TEST-LABEL-A' }, { tag: 'TEST-LABEL-B' }],
          visionApiTags: ['TEST-LABEL-A', 'TEST-LABEL-B'],
        },
      },
    );
    // assert for saving new labels
    await Promise.resolve();
    expect(savedTags.create).toHaveBeenCalledTimes(2);
    expect(savedTags.create).toHaveBeenNthCalledWith(1, { tag: 'TEST-LABEL-A' });
    expect(savedTags.create).toHaveBeenNthCalledWith(2, { tag: 'TEST-LABEL-B' });
  });

  test('will create a new pin from original link if S3 upload fails for any other reason', async () => {
    const req = {
      user,
      body: {
        owner: {
          name: 'tester-twitter',
          service: 'twitter',
          id: user._id,
        },
        imgDescription: 'description-4',
        imgLink: 'https://stub-4',
        _id: 123,
      },
    };

    setupMocks({ ...req.body });
    await addPin(req as genericRequest, res as unknown as Response);
    expect(pins.create).toHaveBeenCalledTimes(1);
    expect(pins.create).toHaveBeenCalledWith({
      ...req.body,
      owner: Types.ObjectId(user._id),
      originalImgLink: req.body.imgLink,
      isBroken: false,
    });
    expect(res.json).toHaveBeenCalledWith({ ...req.body });
    // assert for cloud vision api labeling
    expect(pins.findByIdAndUpdate).toHaveBeenCalledTimes(1);
    expect(pins.findByIdAndUpdate).toHaveBeenCalledWith(
      123,
      {
        $set: {
          tags: [{ tag: 'TEST-LABEL-A' }, { tag: 'TEST-LABEL-B' }],
          visionApiTags: ['TEST-LABEL-A', 'TEST-LABEL-B'],
        },
      },
    );
    // assert for saving new labels
    await Promise.resolve();
    expect(savedTags.create).toHaveBeenCalledTimes(2);
    expect(savedTags.create).toHaveBeenNthCalledWith(1, { tag: 'TEST-LABEL-A' });
    expect(savedTags.create).toHaveBeenNthCalledWith(2, { tag: 'TEST-LABEL-B' });
  });

  test('will respond with error if pin creation limit has been reached', async () => {
    const req = {
      user,
      body: {
        owner: {
          name: 'tester-twitter',
          service: 'twitter',
          id: user._id,
        },
        imgDescription: 'description-4',
        imgLink: 'https://stub-4',
        _id: 123,
      },
    };
    jest.clearAllMocks();
    pins.find = jest.fn().mockImplementation(
      () => ({
        exec: jest.fn().mockResolvedValue([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
      }),
    );
    await addPin(req as genericRequest, res as unknown as Response);
    expect(pins.create).toHaveBeenCalledTimes(0);
    expect(res.json).toHaveBeenCalledWith(Error('UserID: 5cad310f7672ca00146485a8 has reached the pin creation limit - aborted!'));
  });

  test('will respond with error if POST is rejected', async () => {
    pins.find = jest.fn().mockImplementation(
      () => ({
        exec: jest.fn().mockResolvedValue([]),
      }),
    );
    pins.create = jest.fn().mockRejectedValue(new Error('Mocked rejection'));
    const req = {
      user,
      body: {
        owner: {
          name: 'tester-twitter',
          service: 'twitter',
          id: user._id,
        },
        imgDescription: 'description-4',
        imgLink: 'https://stub-4',
      },
    };
    await addPin(req as genericRequest, res as unknown as Response);
    expect(res.json).toHaveBeenCalledWith(Error('Mocked rejection'));
  });
});

describe('generating an AI image', () => {
  let res:{
    json: jest.Mock,
    end: jest.Mock
  };
  beforeEach(() => {
    res = { json: jest.fn(), end: jest.fn() };
    aiGenerated.create = jest.fn().mockResolvedValue({ _id: 'stub_ai_mongoose_storage_ID' });
    aiGenerated.find = jest.fn().mockResolvedValue([1, 2, 3]);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('will make request to openAI to generate a new image', async () => {
    const req = {
      user,
      body: {
        description: 'open ai image creation prompt',
      },
    };
    await generateAIimage(req as genericRequest, res as unknown as Response);
    expect(mockOpenAiInstance.images.generate).toHaveBeenCalledWith({
      model: 'dall-e-3',
      n: 1,
      prompt: 'open ai image creation prompt',
      size: '1024x1024',
    });
    expect(mockOpenAiInstance.chat.completions.create).toHaveBeenCalledWith({
      max_tokens: 10,
      model: 'gpt-3.5-turbo',
      messages: [{
        role: 'user',
        content: 'Create a concise and engaging title, consisting of one or two words, for the given description: open ai image creation prompt',
      }],
    });
    expect(res.json).toHaveBeenCalledWith({
      imgURL: 'http:/stub-ai-image-url',
      title: '[TEST-LABEL-A, TEST-LABEL-B]', // Not really the title but easier to mock just the tags since both use chat completions
      _id: 'stub_ai_mongoose_storage_ID',
    });
  });

  test('will end response if no prompt provided', async () => {
    const req = {
      user,
      body: {
        description: '',
      },
    };
    await generateAIimage(req as genericRequest, res as unknown as Response);
    expect(res.end).toHaveBeenCalled();
  });

  test('will end response if 5 or more AI generated images have been created by the user', async () => {
    aiGenerated.find = jest.fn().mockResolvedValue([1, 2, 3, 4, 5]);
    const req = {
      user,
      body: {
        description: 'open ai image creation prompt',
      },
    };
    await generateAIimage(req as genericRequest, res as unknown as Response);
    expect(res.end).toHaveBeenCalled();
  });

  test('will respond with error if POST is rejected', async () => {
    aiGenerated.create = jest.fn().mockRejectedValue(new Error('Mocked rejection'));
    const req = {
      user,
      body: {
        description: 'open ai image creation prompt',
      },
    };
    await generateAIimage(req as genericRequest, res as unknown as Response);
    expect(res.json).toHaveBeenCalledWith({
      imgURL: '',
      title: '',
      _id: null,
    });
  });
});
